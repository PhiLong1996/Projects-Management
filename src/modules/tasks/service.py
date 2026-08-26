"""Business logic for task management: creation, updates, status transitions,
search/filtering, and audit logging (AC-06, AC-08)."""
import math
import uuid
from datetime import datetime
from typing import List, Optional, Set

from fastapi import HTTPException, status
from sqlalchemy import select, func, or_, asc, desc
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.notifications.service import create_event_notification
from src.modules.notifications.models import NotificationType
from src.modules.projects.models import Project, ProjectMember, ProjectRole, ProjectStatus
from src.modules.sprints.models import Sprint
from src.modules.tasks.models import Task, TaskStatus, TaskPriority, AuditLog
from src.modules.tasks.schemas import TaskCreate, TaskUpdate, TaskStatusUpdatePayload, PaginationMeta
from src.modules.users.models import User, SystemRole

SEARCH_SORT_ALLOWLIST = {
    "title": Task.title,
    "created_at": Task.created_at,
    "updated_at": Task.updated_at,
    "due_date": Task.due_date,
    "priority": Task.priority,
    "status": Task.status,
}

VALID_STATUS_TRANSITIONS = {
    TaskStatus.TODO: {TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED},
    TaskStatus.IN_PROGRESS: {TaskStatus.TODO, TaskStatus.IN_REVIEW, TaskStatus.CANCELLED},
    TaskStatus.IN_REVIEW: {TaskStatus.TODO, TaskStatus.IN_PROGRESS, TaskStatus.DONE, TaskStatus.CANCELLED},
    TaskStatus.DONE: {TaskStatus.TODO, TaskStatus.IN_PROGRESS},
    TaskStatus.CANCELLED: {TaskStatus.TODO},
}

TEAM_MEMBER_ALLOWED_FIELDS = {"status", "actual_hours", "description"}


def _raise_invalid_status_transition(from_status: TaskStatus, to_status: TaskStatus, allowed: Set[TaskStatus]):
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": "INVALID_STATUS_TRANSITION",
            "message": (
                f"Invalid status transition from {from_status.value} to {to_status.value}. "
                f"Allowed: {', '.join(s.value for s in allowed)}."
            ),
        },
    )


async def _verify_active_project_member(project_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession):
    member_res = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
            ProjectMember.is_active == True,
        )
    )
    if not member_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "ASSIGNEE_NOT_PROJECT_MEMBER",
                "message": "Assignee must be an active member of this project.",
            },
        )


async def _verify_task_create_permission(project_id: uuid.UUID, current_user: User, db: AsyncSession):
    if current_user.system_role == SystemRole.ADMIN:
        return
    if current_user.system_role == SystemRole.PROJECT_MANAGER:
        pm_check = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == current_user.id,
                ProjectMember.project_role == ProjectRole.MANAGER,
                ProjectMember.is_active == True,
            )
        )
        if pm_check.scalar_one_or_none():
            return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Only Administrator or Project Manager can create tasks.",
    )


async def create_task(
    db: AsyncSession, current_user: User, project_id: uuid.UUID, payload: TaskCreate
) -> Task:
    project_res = await db.execute(select(Project).where(Project.id == project_id))
    project = project_res.scalar_one_or_none()
    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "PROJECT_NOT_FOUND", "message": "Project not found"},
        )

    if project.status == ProjectStatus.CLOSED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot create tasks in a CLOSED project.",
        )

    await _verify_task_create_permission(project_id, current_user, db)

    if payload.sprint_id:
        sprint_res = await db.execute(
            select(Sprint).where(
                Sprint.id == payload.sprint_id,
                Sprint.project_id == project_id,
            )
        )
        if not sprint_res.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Sprint does not belong to the specified project.",
            )

    if payload.assignee_id:
        await _verify_active_project_member(project_id, payload.assignee_id, db)

    task = Task(
        project_id=project_id,
        sprint_id=payload.sprint_id,
        assignee_id=payload.assignee_id,
        title=payload.title,
        description=payload.description,
        priority=payload.priority,
        status=TaskStatus.TODO,
        due_date=payload.due_date,
        estimated_hours=payload.estimated_hours,
        reporter_id=current_user.id,
    )
    db.add(task)
    await db.flush()

    if payload.assignee_id and payload.assignee_id != current_user.id:
        await create_event_notification(
            db=db,
            recipient_id=payload.assignee_id,
            project_id=project_id,
            type=NotificationType.TASK_ASSIGNED,
            title="Task Assigned",
            message=f"You have been assigned to task '{payload.title}'.",
            entity_type="TASK",
            entity_id=task.id,
        )

    await db.commit()
    await db.refresh(task)
    return task


async def _notify_reassignment(db, task, old_assignee_id, new_assignee_id, current_user):
    if new_assignee_id and new_assignee_id != current_user.id:
        await create_event_notification(
            db=db,
            recipient_id=new_assignee_id,
            project_id=task.project_id,
            type=NotificationType.TASK_REASSIGNED,
            title="Task Reassigned",
            message=f"You have been assigned to task '{task.title}'.",
            entity_type="TASK",
            entity_id=task.id,
        )
    if old_assignee_id and old_assignee_id != current_user.id:
        await create_event_notification(
            db=db,
            recipient_id=old_assignee_id,
            project_id=task.project_id,
            type=NotificationType.TASK_REASSIGNED,
            title="Task Reassigned",
            message=f"You have been unassigned from task '{task.title}'.",
            entity_type="TASK",
            entity_id=task.id,
        )


async def _notify_status_changed(db, task, current_user):
    notify_targets = set()
    if task.assignee_id and task.assignee_id != current_user.id:
        notify_targets.add(task.assignee_id)
    if task.reporter_id and task.reporter_id != current_user.id:
        notify_targets.add(task.reporter_id)
    for rid in notify_targets:
        await create_event_notification(
            db=db,
            recipient_id=rid,
            project_id=task.project_id,
            type=NotificationType.TASK_STATUS_CHANGED,
            title="Task Status Changed",
            message=f"Task '{task.title}' status changed to {task.status.value}.",
            entity_type="TASK",
            entity_id=task.id,
        )


async def update_task(
    db: AsyncSession, current_user: User, task_id: uuid.UUID, payload: TaskUpdate
) -> Task:
    task_res = await db.execute(select(Task).where(Task.id == task_id))
    task = task_res.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return task

    is_admin_or_pm = current_user.system_role in [SystemRole.ADMIN, SystemRole.PROJECT_MANAGER]
    if not is_admin_or_pm:
        if task.assignee_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Team members can only update tasks assigned to them.",
            )
        disallowed = set(updates.keys()) - TEAM_MEMBER_ALLOWED_FIELDS
        if disallowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Team members cannot modify: {', '.join(sorted(disallowed))}. "
                    f"Allowed fields: {', '.join(sorted(TEAM_MEMBER_ALLOWED_FIELDS))}."
                ),
            )

    if "status" in updates:
        new_status = updates["status"]
        allowed = VALID_STATUS_TRANSITIONS.get(task.status, set())
        if new_status not in allowed:
            _raise_invalid_status_transition(task.status, new_status, allowed)

    if "sprint_id" in updates and updates["sprint_id"] != task.sprint_id:
        if updates["sprint_id"]:
            sprint_res = await db.execute(
                select(Sprint).where(
                    Sprint.id == updates["sprint_id"],
                    Sprint.project_id == task.project_id,
                )
            )
            if not sprint_res.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Sprint does not belong to this project.",
                )

    old_assignee_id = task.assignee_id
    if "assignee_id" in updates and updates["assignee_id"] != task.assignee_id:
        if updates["assignee_id"]:
            await _verify_active_project_member(task.project_id, updates["assignee_id"], db)

    auditable_fields = ["assignee_id", "priority", "due_date", "status"]
    for field in auditable_fields:
        if field in updates:
            old_val = str(getattr(task, field)) if getattr(task, field) is not None else None
            new_val = str(updates[field]) if updates[field] is not None else None
            if old_val != new_val:
                db.add(
                    AuditLog(
                        task_id=task.id,
                        actor_id=current_user.id,
                        field_changed=field.replace("_id", ""),
                        old_value=old_val,
                        new_value=new_val,
                    )
                )

    if "status" in updates:
        new_status = updates["status"]
        if new_status == TaskStatus.DONE and task.status != TaskStatus.DONE:
            task.completed_at = datetime.utcnow()
        elif new_status != TaskStatus.DONE and task.status == TaskStatus.DONE:
            task.completed_at = None

    for field, value in updates.items():
        setattr(task, field, value)

    if "assignee_id" in updates and updates["assignee_id"] != old_assignee_id:
        await _notify_reassignment(db, task, old_assignee_id, updates["assignee_id"], current_user)

    if "status" in updates:
        await _notify_status_changed(db, task, current_user)

    priority_due_changed = {"priority", "due_date"} & set(updates.keys())
    if priority_due_changed and task.assignee_id and task.assignee_id != current_user.id:
        await create_event_notification(
            db=db,
            recipient_id=task.assignee_id,
            project_id=task.project_id,
            type=NotificationType.TASK_UPDATED,
            title="Task Updated",
            message=(
                f"Task '{task.title}' has been updated "
                f"({', '.join(sorted(priority_due_changed))})."
            ),
            entity_type="TASK",
            entity_id=task.id,
        )

    await db.commit()
    await db.refresh(task)
    return task


async def update_task_status(
    db: AsyncSession, current_user: User, task_id: uuid.UUID, payload: TaskStatusUpdatePayload
) -> dict:
    task_res = await db.execute(select(Task).where(Task.id == task_id))
    task = task_res.scalar_one_or_none()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "TASK_NOT_FOUND", "message": "Task not found"},
        )

    is_admin_or_pm = current_user.system_role in [SystemRole.ADMIN, SystemRole.PROJECT_MANAGER]
    if not is_admin_or_pm and task.assignee_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the assignee, Project Manager, or Admin can change task status.",
        )

    previous_status = task.status
    new_status = payload.status

    if new_status == previous_status:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Task is already in {previous_status.value} status.",
        )

    allowed = VALID_STATUS_TRANSITIONS.get(previous_status, set())
    if new_status not in allowed:
        _raise_invalid_status_transition(previous_status, new_status, allowed)

    task.status = new_status
    if new_status == TaskStatus.DONE:
        task.completed_at = datetime.utcnow()
    elif previous_status == TaskStatus.DONE:
        task.completed_at = None

    db.add(
        AuditLog(
            task_id=task.id,
            actor_id=current_user.id,
            field_changed="status",
            old_value=previous_status.value,
            new_value=new_status.value,
        )
    )

    notify_targets = set()
    if task.assignee_id and task.assignee_id != current_user.id:
        notify_targets.add(task.assignee_id)
    if task.reporter_id and task.reporter_id != current_user.id:
        notify_targets.add(task.reporter_id)
    for rid in notify_targets:
        await create_event_notification(
            db=db,
            recipient_id=rid,
            project_id=task.project_id,
            type=NotificationType.TASK_STATUS_CHANGED,
            title="Task Status Changed",
            message=(
                f"Task '{task.title}' status changed from "
                f"{previous_status.value} to {new_status.value}."
            ),
            entity_type="TASK",
            entity_id=task.id,
        )

    await db.commit()
    await db.refresh(task)
    return {
        "id": task.id,
        "previous_status": previous_status,
        "status": task.status,
        "updated_at": task.updated_at,
    }


async def get_task_audit_logs(db: AsyncSession, task_id: uuid.UUID) -> List[AuditLog]:
    result = await db.execute(
        select(AuditLog)
        .where(AuditLog.task_id == task_id)
        .order_by(AuditLog.created_at.desc())
    )
    return result.scalars().all()


async def list_project_tasks(
    db: AsyncSession,
    current_user: User,
    project_id: uuid.UUID,
    sprint_id: Optional[uuid.UUID],
    assignee_id: Optional[uuid.UUID],
    status_filter: Optional[TaskStatus],
    priority_filter: Optional[TaskPriority],
    search: Optional[str],
    sort_by: str,
    page: int,
    page_size: int,
) -> dict:
    """AC-08: search/filter/sort/paginate tasks within a project."""
    project_res = await db.execute(select(Project).where(Project.id == project_id))
    if not project_res.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    if current_user.system_role != SystemRole.ADMIN:
        member_res = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == current_user.id,
                ProjectMember.is_active == True,
            )
        )
        if not member_res.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to tasks in this project.",
            )

    # Support sort=-due_date convention from spec
    order = "desc"
    field_name = sort_by
    if sort_by.startswith("-"):
        field_name = sort_by[1:]
        order = "desc"
    elif sort_by.startswith("+"):
        field_name = sort_by[1:]
        order = "asc"

    if field_name not in SEARCH_SORT_ALLOWLIST:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid sort field '{sort_by}'. Allowed fields: {list(SEARCH_SORT_ALLOWLIST.keys())}",
        )

    query = select(Task).where(Task.project_id == project_id)

    if sprint_id:
        query = query.where(Task.sprint_id == sprint_id)
    if assignee_id:
        query = query.where(Task.assignee_id == assignee_id)
    if status_filter:
        query = query.where(Task.status == status_filter)
    if priority_filter:
        query = query.where(Task.priority == priority_filter)
    if search:
        search_pattern = f"%{search.strip()}%"
        query = query.where(
            or_(
                Task.title.ilike(search_pattern),
                Task.description.ilike(search_pattern),
            )
        )

    count_query = select(func.count()).select_from(query.subquery())
    total_items = (await db.execute(count_query)).scalar() or 0

    sort_column = SEARCH_SORT_ALLOWLIST[field_name]
    direction = desc if order == "desc" else asc
    query = query.order_by(direction(sort_column))

    offset = (page - 1) * page_size
    result = await db.execute(query.offset(offset).limit(page_size))
    tasks = result.scalars().all()

    total_pages = math.ceil(total_items / page_size) if total_items > 0 else 0

    return {
        "items": tasks,
        "pagination": PaginationMeta(
            page=page,
            page_size=page_size,
            total_items=total_items,
            total_pages=total_pages,
        ),
    }

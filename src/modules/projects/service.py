"""Business logic for project management and project membership."""
import math
import uuid
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select, func, or_, asc, desc
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.pagination import parse_sort
from src.core.schemas import PaginationMeta
from src.modules.notifications.service import create_event_notification
from src.modules.notifications.models import NotificationType
from src.modules.users.models import User, SystemRole, UserStatus
from src.modules.projects.models import Project, ProjectMember, ProjectRole, ProjectStatus
from src.modules.projects.schemas import ProjectCreate, ProjectUpdate, AddMemberRequest, RemoveMemberRequest
from src.modules.tasks.models import Task, TaskStatus

# spec FR-07: Project search supports filter (status), sort, and pagination.
PROJECT_SORT_ALLOWLIST = {
    "code": Project.code,
    "name": Project.name,
    "status": Project.status,
    "start_date": Project.start_date,
    "end_date": Project.end_date,
    "created_at": Project.created_at,
}


async def verify_pm_or_admin(project_id: uuid.UUID, user: User, db: AsyncSession) -> None:
    """Raise 403 unless `user` is an Administrator or the Project Manager of `project_id`."""
    if user.system_role == SystemRole.ADMIN:
        return
    pm_check = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user.id,
            ProjectMember.project_role == ProjectRole.MANAGER,
            ProjectMember.is_active == True,
        )
    )
    if not pm_check.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only an Administrator or the Project Manager can perform this action.",
        )


async def create_project(db: AsyncSession, current_user: User, payload: ProjectCreate) -> Project:
    # AC-03: Project code must be unique
    existing = await db.execute(select(Project).where(Project.code == payload.code))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Project code '{payload.code}' already exists.",
        )

    project = Project(
        code=payload.code,
        name=payload.name,
        description=payload.description,
        start_date=payload.start_date,
        end_date=payload.end_date,
        created_by=current_user.id,
        status=ProjectStatus.PLANNING,
    )
    db.add(project)
    await db.flush()

    # Automatically add creator as MANAGER in project_members
    db.add(
        ProjectMember(
            project_id=project.id,
            user_id=current_user.id,
            project_role=ProjectRole.MANAGER,
            is_active=True,
        )
    )

    await db.commit()
    await db.refresh(project)
    return project


async def list_projects(
    db: AsyncSession,
    current_user: User,
    search: Optional[str],
    status_filter: Optional[ProjectStatus],
    sort_by: str,
    page: int,
    page_size: int,
) -> dict:
    """FR-07: search/filter/sort/paginate projects.

    AC-03 scoping still applies underneath: Administrator sees every
    project; everyone else only sees projects they're an active member of.
    """
    query = select(Project)
    if current_user.system_role != SystemRole.ADMIN:
        query = query.join(ProjectMember, Project.id == ProjectMember.project_id).where(
            ProjectMember.user_id == current_user.id,
            ProjectMember.is_active == True,
        )

    if status_filter:
        query = query.where(Project.status == status_filter)
    if search:
        search_pattern = f"%{search.strip()}%"
        query = query.where(
            or_(
                Project.name.ilike(search_pattern),
                Project.code.ilike(search_pattern),
            )
        )

    field_name, order = parse_sort(sort_by)
    if field_name not in PROJECT_SORT_ALLOWLIST:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid sort field '{sort_by}'. Allowed fields: {list(PROJECT_SORT_ALLOWLIST.keys())}",
        )

    count_query = select(func.count()).select_from(query.subquery())
    total_items = (await db.execute(count_query)).scalar() or 0

    sort_column = PROJECT_SORT_ALLOWLIST[field_name]
    direction = desc if order == "desc" else asc
    query = query.order_by(direction(sort_column))

    offset = (page - 1) * page_size
    result = await db.execute(query.offset(offset).limit(page_size))
    projects = result.scalars().all()

    total_pages = math.ceil(total_items / page_size) if total_items > 0 else 0

    return {
        "items": projects,
        "pagination": PaginationMeta(
            page=page,
            page_size=page_size,
            total_items=total_items,
            total_pages=total_pages,
        ),
    }


async def update_project(
    db: AsyncSession, current_user: User, project_id: uuid.UUID, payload: ProjectUpdate
) -> Project:
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    # AC-03: Project Manager can only update projects they manage
    if current_user.system_role != SystemRole.ADMIN:
        pm_check = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == current_user.id,
                ProjectMember.project_role == ProjectRole.MANAGER,
                ProjectMember.is_active == True,
            )
        )
        if not pm_check.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the assigned Project Manager or Administrator can update this project.",
            )

    updates = payload.model_dump(exclude_unset=True)

    # Validate the resulting date range: a partial update might only touch
    # one of start_date/end_date, so compare against whichever value is
    # already on the project for the field not being changed.
    new_start = updates.get("start_date", project.start_date)
    new_end = updates.get("end_date", project.end_date)
    if new_start and new_end and new_start > new_end:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="end_date cannot be before start_date",
        )

    for field, value in updates.items():
        setattr(project, field, value)

    await db.commit()
    await db.refresh(project)
    return project


async def _notify_member_added(
    db: AsyncSession, project_id: uuid.UUID, user_id: uuid.UUID, current_user: User
) -> None:
    """Send PROJECT_MEMBER_ADDED notification to the newly added member."""
    if user_id == current_user.id:
        return  # Don't notify yourself

    project_res = await db.execute(select(Project).where(Project.id == project_id))
    project = project_res.scalar_one_or_none()
    project_name = project.name if project else "a project"

    await create_event_notification(
        db=db,
        recipient_id=user_id,
        project_id=project_id,
        type=NotificationType.PROJECT_MEMBER_ADDED,
        title="Added to Project",
        message=f"You have been added to project '{project_name}'.",
        entity_type="PROJECT",
        entity_id=project_id,
    )
    await db.commit()


async def add_project_member(
    db: AsyncSession, current_user: User, project_id: uuid.UUID, payload: AddMemberRequest
) -> ProjectMember:
    # AC-04: Only Administrator or PM of this project can add members
    await verify_pm_or_admin(project_id, current_user, db)

    project_res = await db.execute(select(Project).where(Project.id == project_id))
    project = project_res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if project.status == ProjectStatus.CLOSED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot add members to a CLOSED project.",
        )

    # Validate target user existence and status
    user_res = await db.execute(select(User).where(User.id == payload.user_id))
    target_user = user_res.scalar_one_or_none()
    if not target_user or target_user.status == UserStatus.INACTIVE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found or inactive")

    # AC-04: Cannot add same user twice to the same project
    existing = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == payload.user_id,
        )
    )
    existing_member = existing.scalar_one_or_none()

    if existing_member:
        if existing_member.is_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User is already an active member of this project.",
            )
        # Reactivate member if previously soft-deleted/deactivated
        existing_member.is_active = True
        existing_member.project_role = payload.project_role
        await db.commit()
        await db.refresh(existing_member)

        await _notify_member_added(db, project_id, payload.user_id, current_user)
        return existing_member

    new_member = ProjectMember(
        project_id=project_id,
        user_id=payload.user_id,
        project_role=payload.project_role,
        is_active=True,
    )
    db.add(new_member)
    await db.commit()
    await db.refresh(new_member)

    await _notify_member_added(db, project_id, payload.user_id, current_user)
    return new_member


async def remove_project_member(
    db: AsyncSession,
    current_user: User,
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    payload: RemoveMemberRequest,
) -> None:
    # AC-04: Only Administrator or PM of this project can remove members
    await verify_pm_or_admin(project_id, current_user, db)

    # AC-04: Cannot remove member who still has incomplete tasks unless tasks are reassigned
    open_tasks_query = select(Task).where(
        Task.project_id == project_id,
        Task.assignee_id == user_id,
        Task.status.notin_([TaskStatus.DONE, TaskStatus.CANCELLED]),
    )
    open_tasks = (await db.execute(open_tasks_query)).scalars().all()

    if open_tasks:
        if not payload.reassign_to_user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot remove member with incomplete tasks without specifying a replacement 'reassign_to_user_id'.",
            )

        # AC-04: Validate replacement user is an ACTIVE member of this project
        rep_check = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == payload.reassign_to_user_id,
                ProjectMember.is_active == True,
            )
        )
        if not rep_check.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Target reassignment user must be an active member of this project.",
            )

        # Reassign incomplete tasks to replacement user
        for task in open_tasks:
            task.assignee_id = payload.reassign_to_user_id

    # Deactivate membership
    member_res = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
            ProjectMember.is_active == True,
        )
    )
    member = member_res.scalar_one_or_none()
    if member:
        member.is_active = False
        await db.commit()

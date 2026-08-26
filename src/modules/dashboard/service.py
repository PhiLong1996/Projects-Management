"""Business logic for the project dashboard (AC-09 / Section 16 of the spec)."""
import uuid
from datetime import date
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.dashboard.schemas import (
    DashboardStatsResponse,
    DashboardScope,
    DashboardSummary,
    StatusCount,
    PriorityCount,
)
from src.modules.projects.models import Project, ProjectMember
from src.modules.tasks.models import Task, TaskStatus, TaskPriority
from src.modules.users.models import User, SystemRole


async def get_project_dashboard(
    db: AsyncSession,
    current_user: User,
    project_id: uuid.UUID,
    sprint_id: Optional[uuid.UUID],
    assignee_id: Optional[uuid.UUID],
) -> DashboardStatsResponse:
    project_res = await db.execute(select(Project).where(Project.id == project_id))
    project = project_res.scalar_one_or_none()
    if not project:
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
                detail="You do not have permission to view dashboard stats for this project.",
            )

    filters = [Task.project_id == project_id]
    if sprint_id:
        filters.append(Task.sprint_id == sprint_id)
    if assignee_id:
        filters.append(Task.assignee_id == assignee_id)

    tasks_res = await db.execute(select(Task).where(and_(*filters)))
    tasks = tasks_res.scalars().all()

    scope = DashboardScope(project_id=project_id, sprint_id=sprint_id)

    # AC-09: no data still returns 0 / empty lists, never a server error
    if not tasks:
        return DashboardStatsResponse(scope=scope)

    today = date.today()
    total_tasks = len(tasks)
    completed_tasks = sum(1 for t in tasks if t.status == TaskStatus.DONE)

    overdue_count = 0
    for t in tasks:
        if not t.due_date or t.status in [TaskStatus.DONE, TaskStatus.CANCELLED]:
            continue
        due = t.due_date.date() if hasattr(t.due_date, "date") else t.due_date
        if due < today:
            overdue_count += 1

    completion_rate = round((completed_tasks / total_tasks) * 100, 2) if total_tasks > 0 else 0.0

    status_counts = {s.value: 0 for s in TaskStatus}
    priority_counts = {p.value: 0 for p in TaskPriority}
    for t in tasks:
        status_counts[t.status.value] += 1
        priority_counts[t.priority.value] += 1

    return DashboardStatsResponse(
        scope=scope,
        summary=DashboardSummary(
            total_tasks=total_tasks,
            completed_tasks=completed_tasks,
            overdue_tasks=overdue_count,
            completion_rate=completion_rate,
        ),
        tasks_by_status=[StatusCount(status=s, count=c) for s, c in status_counts.items() if c > 0],
        tasks_by_priority=[PriorityCount(priority=p, count=c) for p, c in priority_counts.items() if c > 0],
    )

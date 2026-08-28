"""Business logic for exporting task reports (AC-11)."""
import csv
import io
import uuid
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.projects.models import ProjectMember, ProjectRole
from src.modules.tasks.models import Task, TaskStatus, TaskPriority
from src.modules.users.models import User, SystemRole


async def export_tasks_csv(
    db: AsyncSession,
    current_user: User,
    project_id: Optional[uuid.UUID],
    sprint_id: Optional[uuid.UUID],
    status_filter: Optional[TaskStatus],
    priority_filter: Optional[TaskPriority],
) -> str:
    if current_user.system_role == SystemRole.TEAM_MEMBER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Team members are not permitted to export reports.",
        )

    query = select(Task)

    if current_user.system_role == SystemRole.ADMIN:
        pass
    elif current_user.system_role == SystemRole.PROJECT_MANAGER:
        managed_projects = select(ProjectMember.project_id).where(
            ProjectMember.user_id == current_user.id,
            ProjectMember.project_role == ProjectRole.MANAGER,
            ProjectMember.is_active == True,
        )
        query = query.where(Task.project_id.in_(managed_projects))
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions to export reports.",
        )

    if project_id:
        if current_user.system_role == SystemRole.PROJECT_MANAGER:
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
                    detail="You can only export reports for projects you manage.",
                )
        query = query.where(Task.project_id == project_id)

    if sprint_id:
        query = query.where(Task.sprint_id == sprint_id)
    if status_filter:
        query = query.where(Task.status == status_filter)
    if priority_filter:
        query = query.where(Task.priority == priority_filter)

    result = await db.execute(query)
    tasks = result.scalars().all()

    output = io.StringIO()
    output.write("﻿")
    writer = csv.writer(output)

    writer.writerow([
        "Task ID",
        "Title",
        "Description",
        "Status",
        "Priority",
        "Project ID",
        "Sprint ID",
        "Assignee ID",
        "Due Date",
        "Completed At",
        "Created At",
    ])

    for task in tasks:
        writer.writerow([
            str(task.id),
            task.title,
            task.description or "",
            task.status.value,
            task.priority.value,
            str(task.project_id),
            str(task.sprint_id) if task.sprint_id else "",
            str(task.assignee_id) if task.assignee_id else "",
            task.due_date.strftime("%Y-%m-%d") if task.due_date else "",
            task.completed_at.strftime("%Y-%m-%d %H:%M:%S") if task.completed_at else "",
            task.created_at.strftime("%Y-%m-%d %H:%M:%S"),
        ])

    output.seek(0)
    return output.getvalue()

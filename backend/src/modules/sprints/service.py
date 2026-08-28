"""Business logic for sprint management (AC-05)."""
import uuid
from typing import List

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.projects.models import Project, ProjectStatus
from src.modules.projects.service import verify_pm_or_admin
from src.modules.sprints.models import Sprint, SprintStatus
from src.modules.sprints.schemas import SprintCreate, SprintUpdate, CloseSprintRequest
from src.modules.tasks.models import Task, TaskStatus
from src.modules.users.models import User


async def _get_project_or_404(db: AsyncSession, project_id: uuid.UUID) -> Project:
    project_res = await db.execute(select(Project).where(Project.id == project_id))
    project = project_res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


async def _active_sprints_excluding(
    db: AsyncSession, project_id: uuid.UUID, exclude_sprint_id: uuid.UUID = None
) -> List[Sprint]:
    query = select(Sprint).where(
        Sprint.project_id == project_id,
        Sprint.status == SprintStatus.ACTIVE,
    )
    if exclude_sprint_id is not None:
        query = query.where(Sprint.id != exclude_sprint_id)
    return (await db.execute(query)).scalars().all()


def _raise_if_overlapping(active_sprints: List[Sprint], start_date, end_date) -> None:
    for active in active_sprints:
        if start_date <= active.end_date and end_date >= active.start_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Sprint dates overlap with an ACTIVE sprint.",
            )


def _raise_if_outside_project_bounds(project: Project, start_date, end_date) -> None:
    if project.start_date and start_date < project.start_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sprint start date cannot be before project start date.",
        )
    if project.end_date and end_date > project.end_date:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Sprint end date cannot be after project end date.",
        )


async def create_sprint(
    db: AsyncSession, current_user: User, project_id: uuid.UUID, payload: SprintCreate
) -> Sprint:
    project = await _get_project_or_404(db, project_id)

    # AC-03: CLOSED Project does NOT allow creating a new Sprint
    if project.status == ProjectStatus.CLOSED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot create a sprint in a CLOSED project.",
        )

    _raise_if_outside_project_bounds(project, payload.start_date, payload.end_date)

    active_sprints = await _active_sprints_excluding(db, project_id)
    _raise_if_overlapping(active_sprints, payload.start_date, payload.end_date)

    await verify_pm_or_admin(project_id, current_user, db)

    sprint = Sprint(
        project_id=project_id,
        name=payload.name,
        goal=payload.goal,
        start_date=payload.start_date,
        end_date=payload.end_date,
        status=SprintStatus.PLANNED,
    )
    db.add(sprint)
    await db.commit()
    await db.refresh(sprint)
    return sprint


async def update_sprint(
    db: AsyncSession,
    current_user: User,
    project_id: uuid.UUID,
    sprint_id: uuid.UUID,
    payload: SprintUpdate,
) -> Sprint:
    await verify_pm_or_admin(project_id, current_user, db)

    sprint_res = await db.execute(
        select(Sprint).where(Sprint.id == sprint_id, Sprint.project_id == project_id)
    )
    sprint = sprint_res.scalar_one_or_none()
    if not sprint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sprint not found")

    project = await _get_project_or_404(db, project_id)

    new_start = payload.start_date if payload.start_date is not None else sprint.start_date
    new_end = payload.end_date if payload.end_date is not None else sprint.end_date

    # AC-05: start_date cannot be after end_date
    if new_start > new_end:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="start_date cannot be after end_date",
        )

    _raise_if_outside_project_bounds(project, new_start, new_end)

    active_sprints = await _active_sprints_excluding(db, project_id, exclude_sprint_id=sprint_id)
    _raise_if_overlapping(active_sprints, new_start, new_end)

    # AC-05: MVP restriction — max 1 ACTIVE sprint per project at a time
    if payload.status == SprintStatus.ACTIVE and sprint.status != SprintStatus.ACTIVE:
        if active_sprints:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A project cannot have more than one ACTIVE sprint at the same time.",
            )

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(sprint, field, value)

    await db.commit()
    await db.refresh(sprint)
    return sprint


async def close_sprint(
    db: AsyncSession,
    current_user: User,
    project_id: uuid.UUID,
    sprint_id: uuid.UUID,
    payload: CloseSprintRequest,
) -> Sprint:
    await verify_pm_or_admin(project_id, current_user, db)

    sprint_res = await db.execute(
        select(Sprint).where(Sprint.id == sprint_id, Sprint.project_id == project_id)
    )
    sprint = sprint_res.scalar_one_or_none()
    if not sprint:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sprint not found")

    if sprint.status == SprintStatus.CLOSED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Sprint is already CLOSED.")

    # AC-05: Handle incomplete tasks upon Sprint closure
    if payload.target_sprint_id:
        target_res = await db.execute(
            select(Sprint).where(
                Sprint.id == payload.target_sprint_id,
                Sprint.project_id == project_id,
                Sprint.status != SprintStatus.CLOSED,
            )
        )
        if not target_res.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Target sprint is invalid or already closed.",
            )

    # Move incomplete tasks to target sprint or Backlog (sprint_id = None)
    await db.execute(
        update(Task)
        .where(
            Task.sprint_id == sprint_id,
            Task.status.notin_([TaskStatus.DONE, TaskStatus.CANCELLED]),
        )
        .values(sprint_id=payload.target_sprint_id)
    )

    sprint.status = SprintStatus.CLOSED
    await db.commit()
    await db.refresh(sprint)
    return sprint


async def list_sprints(db: AsyncSession, project_id: uuid.UUID) -> List[Sprint]:
    result = await db.execute(select(Sprint).where(Sprint.project_id == project_id))
    return result.scalars().all()

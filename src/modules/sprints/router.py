import uuid
from typing import List
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.core.dependencies import get_current_user
from src.modules.users.models import User
from src.modules.sprints import service
from src.modules.sprints.schemas import (
    SprintCreate,
    SprintUpdate,
    CloseSprintRequest,
    SprintResponse,
)

router = APIRouter(prefix="/projects/{project_id}/sprints", tags=["Sprint Management"])


@router.post("", response_model=SprintResponse, status_code=status.HTTP_201_CREATED)
async def create_sprint(
    project_id: uuid.UUID,
    payload: SprintCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.create_sprint(db, current_user, project_id, payload)


@router.patch("/{sprint_id}", response_model=SprintResponse)
async def update_sprint(
    project_id: uuid.UUID,
    sprint_id: uuid.UUID,
    payload: SprintUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.update_sprint(db, current_user, project_id, sprint_id, payload)


@router.post("/{sprint_id}/close", response_model=SprintResponse)
async def close_sprint(
    project_id: uuid.UUID,
    sprint_id: uuid.UUID,
    payload: CloseSprintRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.close_sprint(db, current_user, project_id, sprint_id, payload)


@router.get("", response_model=List[SprintResponse])
async def list_sprints(project_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    return await service.list_sprints(db, project_id)

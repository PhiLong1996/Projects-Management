import uuid
from typing import List
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.core.dependencies import get_current_user, require_roles
from src.modules.users.models import User, SystemRole
from src.modules.projects import service
from src.modules.projects.schemas import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    AddMemberRequest,
    RemoveMemberRequest,
    MemberResponse,
)

router = APIRouter(prefix="/projects", tags=["Project Management"])


# --- AC-03: Project Management ---

@router.post(
    "",
    response_model=ProjectResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(SystemRole.ADMIN, SystemRole.PROJECT_MANAGER))],
)
async def create_project(
    payload: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.create_project(db, current_user, payload)


@router.get("", response_model=List[ProjectResponse])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.list_projects(db, current_user)


@router.patch("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: uuid.UUID,
    payload: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.update_project(db, current_user, project_id, payload)


# --- AC-04: Project Member Management ---

@router.post("/{project_id}/members", response_model=MemberResponse, status_code=status.HTTP_201_CREATED)
async def add_project_member(
    project_id: uuid.UUID,
    payload: AddMemberRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.add_project_member(db, current_user, project_id, payload)


@router.delete("/{project_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_project_member(
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    payload: RemoveMemberRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await service.remove_project_member(db, current_user, project_id, user_id, payload)

import uuid
from typing import List
from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.core.dependencies import get_current_user
from src.modules.users.models import User
from src.modules.tasks import service
from src.modules.tasks.schemas import (
    TaskCreate,
    TaskUpdate,
    TaskResponse,
    AuditLogResponse,
    TaskStatusUpdatePayload,
    TaskStatusUpdateResponse,
)

router = APIRouter(tags=["Task Management"])


@router.post(
    "/projects/{project_id}/tasks",
    response_model=TaskResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_task(
    project_id: uuid.UUID,
    payload: TaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.create_task(db, current_user, project_id, payload)


@router.patch("/tasks/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: uuid.UUID,
    payload: TaskUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.update_task(db, current_user, task_id, payload)


@router.patch("/tasks/{task_id}/status", response_model=TaskStatusUpdateResponse)
async def update_task_status(
    task_id: uuid.UUID,
    payload: TaskStatusUpdatePayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await service.update_task_status(db, current_user, task_id, payload)
    return TaskStatusUpdateResponse(**result)


@router.get("/tasks/{task_id}/audit-logs", response_model=List[AuditLogResponse])
async def get_task_audit_logs(
    task_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.get_task_audit_logs(db, task_id)

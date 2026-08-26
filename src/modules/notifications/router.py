import uuid
from typing import Optional
from fastapi import APIRouter, Depends, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.core.dependencies import get_current_user
from src.modules.users.models import User
from src.modules.notifications import service
from src.modules.notifications.schemas import (
    NotificationResponse,
    PaginatedNotificationResponse,
    BatchMarkReadRequest,
)

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("", response_model=PaginatedNotificationResponse)
async def get_my_notifications(
    is_read: Optional[bool] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.get_my_notifications(db, current_user, is_read, page, page_size)


@router.patch("/{notification_id}/read", response_model=NotificationResponse)
async def mark_notification_read(
    notification_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.mark_notification_read(db, current_user, notification_id)


@router.patch("/read-all", status_code=status.HTTP_200_OK)
async def mark_all_notifications_read(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.mark_all_notifications_read(db, current_user)


# --- Legacy batch mark-read (kept for backward compatibility) ---
@router.patch("/mark-read", status_code=status.HTTP_200_OK)
async def mark_notifications_read_batch(
    payload: BatchMarkReadRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.mark_notifications_read_batch(db, current_user, payload)

"""Business logic for notifications: querying, marking read, and the event
dispatcher (`create_event_notification`) used by other modules to emit
in-app notifications per Section 17 of the spec."""
import uuid
import math
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.projects.models import ProjectMember
from src.modules.notifications.models import Notification, NotificationType
from src.modules.notifications.schemas import PaginatedNotificationResponse, BatchMarkReadRequest
from src.modules.users.models import User


async def get_my_notifications(
    db: AsyncSession,
    current_user: User,
    is_read: Optional[bool],
    page: int,
    page_size: int,
) -> PaginatedNotificationResponse:
    # AC-10: Users only view their own notifications
    base_filter = [Notification.recipient_id == current_user.id]
    if is_read is not None:
        base_filter.append(Notification.is_read == is_read)

    count_result = await db.execute(
        select(func.count()).select_from(Notification).where(*base_filter)
    )
    total_items = count_result.scalar() or 0
    total_pages = max(1, math.ceil(total_items / page_size))

    result = await db.execute(
        select(Notification)
        .where(*base_filter)
        .order_by(Notification.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = result.scalars().all()

    return PaginatedNotificationResponse(
        items=items,
        total_items=total_items,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


async def mark_notification_read(
    db: AsyncSession, current_user: User, notification_id: uuid.UUID
) -> Notification:
    result = await db.execute(
        select(Notification).where(
            Notification.id == notification_id,
            Notification.recipient_id == current_user.id,
        )
    )
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found.")

    notif.is_read = True
    notif.read_at = datetime.utcnow()
    await db.commit()
    await db.refresh(notif)
    return notif


async def mark_all_notifications_read(db: AsyncSession, current_user: User) -> dict:
    now = datetime.utcnow()
    await db.execute(
        update(Notification)
        .where(
            Notification.recipient_id == current_user.id,
            Notification.is_read == False,
        )
        .values(is_read=True, read_at=now)
    )
    await db.commit()
    return {"message": "All notifications marked as read."}


async def mark_notifications_read_batch(
    db: AsyncSession, current_user: User, payload: BatchMarkReadRequest
) -> dict:
    now = datetime.utcnow()
    await db.execute(
        update(Notification)
        .where(
            Notification.id.in_(payload.notification_ids),
            Notification.recipient_id == current_user.id,
        )
        .values(is_read=True, read_at=now)
    )
    await db.commit()
    return {"message": "Notifications marked as read."}


# --- Event Dispatcher ---

async def create_event_notification(
    db: AsyncSession,
    recipient_id: uuid.UUID,
    project_id: uuid.UUID,
    title: str,
    message: str,
    type: NotificationType = NotificationType.TASK_UPDATED,
    entity_type: Optional[str] = None,
    entity_id: Optional[uuid.UUID] = None,
    event_key: Optional[str] = None,
):
    """
    Create a notification for a user.

    Args:
        db: Database session.
        recipient_id: Target user for the notification.
        project_id: Project context (used to verify membership).
        title: Notification title.
        message: Notification message body.
        type: NotificationType enum value.
        entity_type: Related entity type (e.g. "TASK", "PROJECT").
        entity_id: Related entity UUID.
        event_key: Deduplication key for deadline notifications.
    """
    # AC-10: Check recipient still has active access to the project
    member_check = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == recipient_id,
            ProjectMember.is_active == True,
        )
    )
    if not member_check.scalar_one_or_none():
        return  # Do not notify revoked users

    # AC-10 Deduplication: Avoid duplicate notifications for the same event
    if event_key:
        existing = await db.execute(
            select(Notification).where(
                Notification.recipient_id == recipient_id,
                Notification.deduplication_key == event_key,
            )
        )
        if existing.scalar_one_or_none():
            return

    notif = Notification(
        recipient_id=recipient_id,
        type=type,
        title=title,
        message=message,
        entity_type=entity_type,
        entity_id=entity_id,
        deduplication_key=event_key,
        is_read=False,
    )
    db.add(notif)
    # Note: caller is responsible for db.commit()

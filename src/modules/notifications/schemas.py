import uuid
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel
from src.modules.notifications.models import NotificationType


class NotificationResponse(BaseModel):
    id: uuid.UUID
    recipient_id: uuid.UUID
    type: NotificationType
    title: str
    message: str
    entity_type: Optional[str] = None
    entity_id: Optional[uuid.UUID] = None
    is_read: bool
    read_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class PaginatedNotificationResponse(BaseModel):
    items: List[NotificationResponse]
    total_items: int
    page: int
    page_size: int
    total_pages: int


class BatchMarkReadRequest(BaseModel):
    notification_ids: List[uuid.UUID]
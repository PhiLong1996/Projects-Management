import uuid
from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel, Field, field_validator
from src.modules.tasks.models import TaskPriority, TaskStatus
# Re-exported for existing `from src.modules.tasks.schemas import
# PaginationMeta, PaginatedResponse` call sites (tasks/service.py,
# tasks/search_router.py) — the actual definitions now live in
# src.core.schemas so Project/Task/User search (spec FR-07) share one
# implementation instead of each module inventing its own.
from src.core.schemas import PaginationMeta, PaginatedResponse  # noqa: F401


def _normalize_to_naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Every datetime the app generates itself (created_at, updated_at, ...)
    is a naive UTC value from `datetime.utcnow()`, and the DB columns are
    plain `TIMESTAMP WITHOUT TIME ZONE`. Clients, however, commonly send
    due_date as an ISO string with an offset/"Z" (e.g. "...T03:47:43Z"),
    which Pydantic parses into a timezone-AWARE datetime. SQLite tolerates
    the mismatch silently, but Postgres/asyncpg does not: binding an aware
    datetime to a naive column raises
    `TypeError: can't subtract offset-naive and offset-aware datetimes`
    deep in asyncpg's codec. Converting to naive UTC here keeps every
    datetime the app stores on this consistent footing regardless of what
    the client sent.
    """
    if value is not None and value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    priority: TaskPriority
    sprint_id: Optional[uuid.UUID] = None
    assignee_id: Optional[uuid.UUID] = None
    due_date: Optional[datetime] = None
    estimated_hours: Optional[float] = Field(None, ge=0.0)

    @field_validator("due_date")
    @classmethod
    def _due_date_naive_utc(cls, v: Optional[datetime]) -> Optional[datetime]:
        return _normalize_to_naive_utc(v)


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    priority: Optional[TaskPriority] = None
    status: Optional[TaskStatus] = None
    sprint_id: Optional[uuid.UUID] = None
    assignee_id: Optional[uuid.UUID] = None
    due_date: Optional[datetime] = None
    estimated_hours: Optional[float] = Field(None, ge=0.0)
    actual_hours: Optional[float] = Field(None, ge=0.0)

    @field_validator("due_date")
    @classmethod
    def _due_date_naive_utc(cls, v: Optional[datetime]) -> Optional[datetime]:
        return _normalize_to_naive_utc(v)


class TaskResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    sprint_id: Optional[uuid.UUID] = None
    assignee_id: Optional[uuid.UUID] = None
    reporter_id: uuid.UUID
    title: str
    description: Optional[str] = None
    priority: TaskPriority
    status: TaskStatus
    due_date: Optional[datetime] = None
    estimated_hours: Optional[float] = None
    actual_hours: Optional[float] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AuditLogResponse(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    actor_id: uuid.UUID
    field_changed: str
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class CommentCreate(BaseModel):
    content: str = Field(..., min_length=1)

    @field_validator("content")
    def validate_non_empty_after_strip(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("Comment content cannot be empty or whitespace only.")
        return stripped


class CommentResponse(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    author_id: uuid.UUID
    content: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class AttachmentResponse(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    uploaded_by: uuid.UUID
    original_name: str
    storage_key: str
    size_bytes: int
    content_type: str
    created_at: datetime

    class Config:
        from_attributes = True


class TaskStatusUpdatePayload(BaseModel):
    status: TaskStatus


class TaskStatusUpdateResponse(BaseModel):
    id: uuid.UUID
    previous_status: TaskStatus
    status: TaskStatus
    updated_at: datetime

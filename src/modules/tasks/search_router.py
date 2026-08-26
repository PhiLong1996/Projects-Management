import uuid
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.core.dependencies import get_current_user
from src.modules.users.models import User
from src.modules.tasks import service
from src.modules.tasks.models import TaskPriority, TaskStatus
from src.modules.tasks.schemas import TaskResponse, PaginatedResponse

router = APIRouter(prefix="/projects/{project_id}/tasks", tags=["Task Search & Query"])


@router.get("", response_model=PaginatedResponse[TaskResponse])
async def list_project_tasks(
    project_id: uuid.UUID,
    sprint_id: Optional[uuid.UUID] = None,
    assignee_id: Optional[uuid.UUID] = None,
    status_filter: Optional[TaskStatus] = Query(None, alias="status"),
    priority_filter: Optional[TaskPriority] = Query(None, alias="priority"),
    search: Optional[str] = Query(None, description="Search in title or description"),
    sort_by: str = Query("created_at", description="Field name to sort by; prefix with - for desc"),
    page: int = Query(1, ge=1, description="Page number (1-based)"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page (max 100)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.list_project_tasks(
        db,
        current_user,
        project_id,
        sprint_id,
        assignee_id,
        status_filter,
        priority_filter,
        search,
        sort_by,
        page,
        page_size,
    )

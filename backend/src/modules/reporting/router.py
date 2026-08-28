import uuid
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.core.dependencies import get_current_user
from src.modules.users.models import User
from src.modules.reporting import service
from src.modules.tasks.models import TaskStatus, TaskPriority

router = APIRouter(prefix="/reports", tags=["Reporting"])


@router.get("/tasks/csv")
async def export_tasks_csv(
    project_id: Optional[uuid.UUID] = Query(None),
    sprint_id: Optional[uuid.UUID] = Query(None),
    status_filter: Optional[TaskStatus] = Query(None, alias="status"),
    priority_filter: Optional[TaskPriority] = Query(None, alias="priority"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    csv_text = await service.export_tasks_csv(
        db, current_user, project_id, sprint_id, status_filter, priority_filter
    )
    filename = f"tasks_report_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([csv_text]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )

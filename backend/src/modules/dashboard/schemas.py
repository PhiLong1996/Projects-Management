import uuid
from typing import List, Optional
from pydantic import BaseModel


class DashboardScope(BaseModel):
    project_id: uuid.UUID
    sprint_id: Optional[uuid.UUID] = None


class DashboardSummary(BaseModel):
    total_tasks: int = 0
    completed_tasks: int = 0
    overdue_tasks: int = 0
    completion_rate: float = 0.0


class StatusCount(BaseModel):
    status: str
    count: int


class PriorityCount(BaseModel):
    priority: str
    count: int


class DashboardStatsResponse(BaseModel):
    scope: Optional[DashboardScope] = None
    summary: DashboardSummary = DashboardSummary()
    tasks_by_status: List[StatusCount] = []
    tasks_by_priority: List[PriorityCount] = []

import uuid
from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, Field, model_validator
from src.modules.sprints.models import SprintStatus


class SprintCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    goal: Optional[str] = None
    start_date: date
    end_date: date

    # AC-05: start_date cannot be after end_date
    @model_validator(mode="after")
    def validate_dates(self):
        if self.start_date > self.end_date:
            raise ValueError("start_date cannot be after end_date")
        return self


class SprintUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    goal: Optional[str] = None
    status: Optional[SprintStatus] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class CloseSprintRequest(BaseModel):
    target_sprint_id: Optional[uuid.UUID] = None  # None = move incomplete tasks to Backlog


class SprintResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    goal: Optional[str] = None
    status: SprintStatus
    start_date: date
    end_date: date
    created_at: datetime

    class Config:
        from_attributes = True
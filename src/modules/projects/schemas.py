import uuid
from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, Field, field_validator
from src.modules.projects.models import ProjectStatus, ProjectRole


# --- Project Schemas ---
class ProjectCreate(BaseModel):
    code: str = Field(..., min_length=2, max_length=50)
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None

    @field_validator("code")
    def normalize_code(cls, v: str) -> str:
        return v.strip().upper()


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    status: Optional[ProjectStatus] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None


class ProjectResponse(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    description: Optional[str] = None
    status: ProjectStatus
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# --- Project Member Schemas ---
class AddMemberRequest(BaseModel):
    user_id: uuid.UUID
    project_role: ProjectRole = ProjectRole.MEMBER


class RemoveMemberRequest(BaseModel):
    reassign_to_user_id: Optional[uuid.UUID] = None  # Mandatory if target member has open tasks


class MemberResponse(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    user_id: uuid.UUID
    project_role: ProjectRole
    is_active: bool
    joined_at: datetime

    class Config:
        from_attributes = True
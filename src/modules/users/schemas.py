import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, Field
from src.modules.users.models import SystemRole, UserStatus


# --- User & Admin Schemas ---
class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=8)
    system_role: SystemRole = SystemRole.TEAM_MEMBER


class UpdateUserStatus(BaseModel):
    status: UserStatus


class UpdateUserRole(BaseModel):
    system_role: SystemRole


class UpdateUserProfile(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = Field(None, min_length=1, max_length=255)


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    system_role: SystemRole
    status: UserStatus
    last_login_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
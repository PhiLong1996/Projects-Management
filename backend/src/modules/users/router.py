import uuid
from typing import Optional
from fastapi import APIRouter, Depends, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db
from src.core.dependencies import require_roles, get_current_user
from src.core.schemas import PaginatedResponse
from src.modules.users import service
from src.modules.users.models import User, SystemRole, UserStatus
from src.modules.users.schemas import (
    UserCreate,
    UpdateUserStatus,
    UpdateUserRole,
    UpdateUserProfile,
    UserResponse,
)

router = APIRouter(prefix="/users", tags=["User Management"])


@router.post(
    "",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles(SystemRole.ADMIN))],
)
async def create_user(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    return await service.create_user(db, payload)


@router.patch(
    "/{user_id}/status",
    response_model=UserResponse,
    dependencies=[Depends(require_roles(SystemRole.ADMIN))],
)
async def update_user_status(
    user_id: uuid.UUID, payload: UpdateUserStatus, db: AsyncSession = Depends(get_db)
):
    return await service.update_user_status(db, user_id, payload)


@router.patch(
    "/{user_id}/role",
    response_model=UserResponse,
    dependencies=[Depends(require_roles(SystemRole.ADMIN))],
)
async def update_user_role(
    user_id: uuid.UUID, payload: UpdateUserRole, db: AsyncSession = Depends(get_db)
):
    return await service.update_user_role(db, user_id, payload)


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user_profile(
    user_id: uuid.UUID,
    payload: UpdateUserProfile,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.update_user_profile(db, current_user, user_id, payload)


@router.get("", response_model=PaginatedResponse[UserResponse])
async def list_users(
    search: Optional[str] = Query(None, description="Search by name or email"),
    status_filter: Optional[UserStatus] = Query(None, alias="status"),
    role_filter: Optional[SystemRole] = Query(None, alias="role"),
    sort_by: str = Query("created_at", description="Field name to sort by; prefix with - for desc"),
    page: int = Query(1, ge=1, description="Page number (1-based)"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page (max 100)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.list_users(
        db, current_user, search, status_filter, role_filter, sort_by, page, page_size
    )

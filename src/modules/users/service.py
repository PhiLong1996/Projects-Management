"""Business logic for user administration and profile management."""
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import select, update, or_
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.security import hash_password
from src.modules.auth.models import RefreshToken
from src.modules.users.models import User, SystemRole, UserStatus
from src.modules.users.schemas import UserCreate, UpdateUserStatus, UpdateUserRole, UpdateUserProfile


async def create_user(db: AsyncSession, payload: UserCreate) -> User:
    # AC-02: Email normalization & uniqueness validation
    normalized_email = payload.email.strip().lower()

    existing = await db.execute(select(User).where(User.email == normalized_email))
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email address is already in use",
        )

    new_user = User(
        email=normalized_email,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        system_role=payload.system_role,
        status=UserStatus.ACTIVE,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    # AC-02: Returns UserResponse object (excludes password_hash)
    return new_user


async def _get_user_or_404(db: AsyncSession, user_id: uuid.UUID) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


async def update_user_status(db: AsyncSession, user_id: uuid.UUID, payload: UpdateUserStatus) -> User:
    # AC-02: Administrator locks/unlocks users
    user = await _get_user_or_404(db, user_id)
    user.status = payload.status

    # AC-02: Locked users cannot refresh tokens; revoke all active refresh tokens immediately
    if payload.status == UserStatus.LOCKED:
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=datetime.utcnow())
        )

    await db.commit()
    await db.refresh(user)
    return user


async def update_user_role(db: AsyncSession, user_id: uuid.UUID, payload: UpdateUserRole) -> User:
    # AC-02: Administrator updates system role
    user = await _get_user_or_404(db, user_id)
    user.system_role = payload.system_role
    await db.commit()
    await db.refresh(user)
    return user


async def update_user_profile(
    db: AsyncSession, current_user: User, user_id: uuid.UUID, payload: UpdateUserProfile
) -> User:
    # Only Admin or the user themselves can update their profile
    if current_user.system_role != SystemRole.ADMIN and current_user.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to update this user's profile.",
        )

    user = await _get_user_or_404(db, user_id)

    updates = payload.model_dump(exclude_unset=True)
    if "email" in updates:
        normalized_email = updates["email"].strip().lower()
        existing = await db.execute(
            select(User).where(User.email == normalized_email, User.id != user_id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email address is already in use",
            )
        user.email = normalized_email

    if "full_name" in updates:
        user.full_name = updates["full_name"]

    await db.commit()
    await db.refresh(user)
    return user


async def list_users(
    db: AsyncSession,
    current_user: User,
    search: Optional[str],
    status_filter: Optional[UserStatus],
    role_filter: Optional[SystemRole],
) -> List[User]:
    query = select(User)

    # Scoping for Project Manager / Team Member (V = view only within projects they're in)
    if current_user.system_role != SystemRole.ADMIN:
        from src.modules.projects.models import ProjectMember

        user_project_ids_subquery = select(ProjectMember.project_id).where(
            ProjectMember.user_id == current_user.id,
            ProjectMember.is_active == True,
        )
        sharing_users_subquery = select(ProjectMember.user_id).where(
            ProjectMember.project_id.in_(user_project_ids_subquery),
            ProjectMember.is_active == True,
        )
        query = query.where(or_(User.id.in_(sharing_users_subquery), User.id == current_user.id))

    if status_filter:
        query = query.where(User.status == status_filter)
    if role_filter:
        query = query.where(User.system_role == role_filter)
    if search:
        search_pattern = f"%{search.strip()}%"
        query = query.where(
            or_(
                User.full_name.ilike(search_pattern),
                User.email.ilike(search_pattern),
            )
        )

    result = await db.execute(query)
    return result.scalars().all()

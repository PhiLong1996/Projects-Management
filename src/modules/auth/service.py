"""Business logic for authentication: login, token refresh, logout, password change.

Kept separate from router.py so the HTTP layer only handles request/response
wiring; all DB access and business rules live here (Layered Architecture per
the spec's Section 7 "Suggested Architecture").

Refresh token handling follows standard practice: the token handed to the
client is an opaque random string (not a JWT — its validity is always
checked against the DB anyway, so there's nothing to gain from it being
self-describing), and only its SHA-256 hash is ever persisted. Rotation
happens on every refresh, and presenting an already-rotated-out (revoked)
token is treated as a possible theft signal: it revokes every session for
that user, not just the one token.
"""
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import get_settings
from src.core.email import send_email
from src.core.security import (
    verify_password,
    hash_password,
    create_access_token,
    generate_refresh_token,
    hash_token,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    REFRESH_TOKEN_EXPIRE_DAYS,
    PASSWORD_RESET_TOKEN_EXPIRE_MINUTES,
)
from src.modules.auth.models import RefreshToken, PasswordResetToken
from src.modules.auth.schemas import ChangePasswordRequest, TokenResponse
from src.modules.users.models import User, UserStatus


def _issue_token_pair(db: AsyncSession, user: User) -> TokenResponse:
    access_token = create_access_token(data={"sub": str(user.id)})
    raw_refresh_token = generate_refresh_token()

    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_token(raw_refresh_token),
            expires_at=datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        )
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=raw_refresh_token,
        token_type="bearer",
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=user,
    )


async def login(db: AsyncSession, email: str, password: str) -> TokenResponse:
    normalized_email = email.strip().lower()

    result = await db.execute(select(User).where(User.email == normalized_email))
    user = result.scalar_one_or_none()

    # AC-01: Invalid password must not reveal email existence (uniform 401 response)
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # AC-01: Reject locked users with 403 Forbidden
    if user.status == UserStatus.LOCKED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is locked. Contact your administrator.",
        )

    token_response = _issue_token_pair(db, user)
    user.last_login_at = datetime.utcnow()
    await db.commit()
    return token_response


async def _revoke_all_sessions(db: AsyncSession, user_id) -> None:
    """Kill every active refresh token for a user — used as the response to
    detected refresh-token reuse (a likely theft signal)."""
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.utcnow())
    )


async def refresh_access_token(db: AsyncSession, refresh_token: str) -> TokenResponse:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(refresh_token))
    )
    stored_token = result.scalar_one_or_none()
    if not stored_token:
        raise credentials_exception

    if stored_token.is_revoked:
        # Reuse of a token that was already rotated out (or explicitly
        # revoked) is a strong signal of theft — the legitimate client
        # would be holding the newer token, not this one. Kill every
        # session for this user rather than just rejecting the request.
        await _revoke_all_sessions(db, stored_token.user_id)
        await db.commit()
        raise credentials_exception

    if stored_token.expires_at < datetime.utcnow():
        raise credentials_exception

    # AC-01 / AC-02: Check user existence and locked status
    user_result = await db.execute(select(User).where(User.id == stored_token.user_id))
    user = user_result.scalar_one_or_none()

    if not user or user.status == UserStatus.LOCKED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is locked or unavailable",
        )

    # Rotate refresh token: revoke old one, issue new pair
    stored_token.revoked_at = datetime.utcnow()
    token_response = _issue_token_pair(db, user)
    await db.commit()
    return token_response


async def logout(db: AsyncSession, refresh_token: str) -> None:
    """Revoke a refresh token, ending that session.

    Deliberately does NOT require a valid access token: the refresh token
    itself is a secret only its legitimate holder has, so presenting it is
    sufficient proof of ownership (no separate `current_user` dependency
    needed). This also means logout still works even if the access token
    has already expired — which is a real scenario (access tokens expire in
    30 minutes; refresh tokens live 7 days), and previously made logout
    impossible to call once idle for too long.
    """
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(refresh_token))
    )
    token_record = result.scalar_one_or_none()

    if token_record and not token_record.is_revoked:
        token_record.revoked_at = datetime.utcnow()
        await db.commit()


async def change_password(db: AsyncSession, current_user: User, payload: ChangePasswordRequest) -> dict:
    # AC-01: Require current password to be correct
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    current_user.password_hash = hash_password(payload.new_password)

    # AC-01 Policy: Revoke all existing refresh sessions for this user upon password change
    await _revoke_all_sessions(db, current_user.id)

    await db.commit()
    return {"message": "Password changed successfully. Active sessions invalidated."}


async def forgot_password(db: AsyncSession, email: str) -> None:
    """Start a password reset: email a one-time reset link if the account
    exists. Always succeeds from the caller's point of view — same
    uniform-response principle as login's "don't reveal whether the email
    exists" (AC-01) — so this never leaks account existence or status via
    response differences, and the router always returns 204 regardless of
    what happened here.
    """
    normalized_email = email.strip().lower()
    result = await db.execute(select(User).where(User.email == normalized_email))
    user = result.scalar_one_or_none()

    # No account, or a locked account: silently do nothing rather than
    # erroring — a 404/403 here would let an attacker enumerate emails or
    # account status by watching the response.
    if not user or user.status == UserStatus.LOCKED:
        return

    raw_token = generate_refresh_token()  # reused: same opaque-token generator as refresh tokens
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=hash_token(raw_token),
            expires_at=datetime.utcnow() + timedelta(minutes=PASSWORD_RESET_TOKEN_EXPIRE_MINUTES),
        )
    )
    await db.commit()

    settings = get_settings()
    reset_link = f"{settings.frontend_url.rstrip('/')}/reset-password?token={raw_token}"
    await send_email(
        to=user.email,
        subject="Reset your password",
        body=(
            f"Hi {user.full_name},\n\n"
            "We received a request to reset your password. This link is valid for "
            f"{PASSWORD_RESET_TOKEN_EXPIRE_MINUTES} minutes:\n\n"
            f"{reset_link}\n\n"
            "If you didn't request this, you can safely ignore this email — "
            "your password will not be changed."
        ),
    )


async def reset_password(db: AsyncSession, token: str, new_password: str) -> None:
    """Complete a password reset using the token emailed by forgot_password."""
    invalid_token_exception = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Invalid or expired reset token",
    )

    result = await db.execute(
        select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(token))
    )
    record = result.scalar_one_or_none()

    if not record or record.is_used or record.expires_at < datetime.utcnow():
        raise invalid_token_exception

    user_result = await db.execute(select(User).where(User.id == record.user_id))
    user = user_result.scalar_one_or_none()
    if not user or user.status == UserStatus.LOCKED:
        raise invalid_token_exception

    user.password_hash = hash_password(new_password)
    record.used_at = datetime.utcnow()

    # Same policy as change_password: a password reset should invalidate
    # every existing session, not just future logins.
    await _revoke_all_sessions(db, user.id)

    await db.commit()

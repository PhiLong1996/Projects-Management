import uuid
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from src.database import get_db
from src.core.security import SECRET_KEY, ALGORITHM
from src.modules.users.models import User, UserStatus, SystemRole

# Plain "expect a Bearer token" scheme — NOT OAuth2PasswordBearer. This app's
# /auth/login is a custom JSON endpoint (email/password body), not the real
# OAuth2 password grant (username/password form) that OAuth2PasswordBearer
# advertises to clients/Swagger. Using the real OAuth2 scheme here made
# Swagger's "Authorize" dialog build a form-encoded POST to /auth/login that
# our endpoint can't parse (422), since it doesn't match our JSON contract.
# HTTPBearer just means "read the token out of the Authorization header" and
# gives Swagger a simple paste-your-token box instead.
bearer_scheme = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    token = credentials.credentials
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        token_type: str = payload.get("type")
        if user_id is None or token_type != "access":
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()
    
    if user is None or user.status == UserStatus.LOCKED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="User account is locked or inactive"
        )
    return user

def require_roles(*allowed_roles: SystemRole):
    """Enforce System Level Roles (ADMIN, PROJECT_MANAGER, etc.)"""
    def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.system_role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not enough permissions to perform this action"
            )
        return current_user
    return role_checker
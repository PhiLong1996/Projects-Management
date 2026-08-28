import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_db, AsyncSessionLocal
from src.core.dependencies import get_current_user, get_user_from_access_token
from src.core.realtime import manager as realtime_manager
from src.modules.users.models import User
from src.modules.notifications import service
from src.modules.notifications.schemas import (
    NotificationResponse,
    PaginatedNotificationResponse,
    BatchMarkReadRequest,
)

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("", response_model=PaginatedNotificationResponse)
async def get_my_notifications(
    is_read: Optional[bool] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.get_my_notifications(db, current_user, is_read, page, page_size)


@router.patch("/{notification_id}/read", response_model=NotificationResponse)
async def mark_notification_read(
    notification_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.mark_notification_read(db, current_user, notification_id)


@router.patch("/read-all", status_code=status.HTTP_200_OK)
async def mark_all_notifications_read(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.mark_all_notifications_read(db, current_user)


# --- Legacy batch mark-read (kept for backward compatibility) ---
@router.patch("/mark-read", status_code=status.HTTP_200_OK)
async def mark_notifications_read_batch(
    payload: BatchMarkReadRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await service.mark_notifications_read_batch(db, current_user, payload)


@router.websocket("/ws")
async def notifications_websocket(websocket: WebSocket, token: str = Query(...)):
    """Realtime notification delivery.

    Connect with `wss://<host>/api/v1/notifications/ws?token=<access_token>`
    — the same JWT access token used for `Authorization: Bearer` elsewhere.
    It has to travel as a query param here instead of a header: browsers'
    native WebSocket API can't set custom headers on the handshake.

    Every Notification created for this user (see
    src/modules/notifications/service.py's create_event_notification) is
    pushed here as JSON — same shape as NotificationResponse, plus
    `recipient_id` — as soon as its transaction actually commits. See
    src/core/realtime.py for the full path from DB row to this socket
    (including how it fans out across multiple app instances via Redis).

    The connection doesn't expect anything from the client after connecting
    — it's kept open purely to receive pushes and to let the server detect
    a disconnect. Any message the client sends is read and discarded rather
    than treated as some keepalive/ping protocol, so a minimal client
    doesn't need to implement one.
    """
    # A short-lived session just to validate the token — unlike the HTTP
    # endpoints above, this connection can stay open far longer than a
    # request, so it shouldn't hold a DB session/connection for its whole
    # lifetime.
    async with AsyncSessionLocal() as db:
        try:
            user = await get_user_from_access_token(token, db)
        except HTTPException:
            # Reject before accept()ing — Starlette turns this into a
            # standard handshake rejection rather than an ordinary close of
            # an established connection.
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

    user_id = str(user.id)
    await realtime_manager.connect(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        realtime_manager.disconnect(user_id, websocket)

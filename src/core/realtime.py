"""Live delivery for notifications: WebSocket to the browser, Redis pub/sub
to fan the event out across app instances/workers.

Why both, not just one:
  - `create_event_notification()` (src/modules/notifications/service.py)
    writes a Notification row inside the caller's existing transaction —
    that part was already correct. What was missing was telling a
    connected client a new row exists, instead of it having to poll.
  - A plain in-memory {user_id: [websocket, ...]} map (ConnectionManager,
    below) is enough to push to a socket connected to *this* process. But
    docker-compose can run `web` as more than one container/worker, and a
    notification created by the request handled on instance A needs to
    reach a socket that happened to connect to instance B. Redis Pub/Sub is
    the fan-out layer that makes that work: every instance PUBLISHes
    outgoing notifications to one channel and SUBSCRIBEs to the same
    channel, then each only forwards to the sockets it personally holds.
  - This is deliberately not RabbitMQ: broadcasting a small "hey, push this"
    message to every instance doesn't need queues, exchanges, routing keys,
    or ack/retry semantics — RabbitMQ is the right tool for durable work
    queues (e.g. background jobs), not for a lightweight one-shot fan-out
    like this.

How a Notification row becomes a push, end to end:
  1. create_event_notification() adds the row, flushes (so it gets its
     id/created_at without ending the transaction), and stashes a plain
     dict describing it on the SQLAlchemy Session's `.info` (a session-
     scoped, framework-provided place to carry request-local state).
  2. `_broadcast_after_commit`, registered below as a SQLAlchemy
     `after_commit` event, fires once the caller's `db.commit()` actually
     succeeds — never on a rolled-back transaction — and schedules the
     publish as an asyncio task. This is what lets this stay a one-line
     addition to create_event_notification() instead of touching every
     call site (tasks/service.py, comments/service.py, projects/service.py,
     the deadline job, ...) that currently creates notifications and commits.
  3. `_publish` PUBLISHes {recipient_id, notification} as JSON to Redis.
  4. Every instance's `redis_subscriber_loop` (started in app.py's
     lifespan) is SUBSCRIBEd and receives it, and hands it to the local
     ConnectionManager, which pushes to that recipient's open WebSocket(s)
     on *this* instance, if any.
"""
import asyncio
import json
import logging
from collections import defaultdict
from typing import Dict, Optional, Set

from fastapi import WebSocket
from redis import asyncio as aioredis
from sqlalchemy import event
from sqlalchemy.orm import Session

from src.config import get_settings

logger = logging.getLogger("realtime")

CHANNEL = "notifications"


class ConnectionManager:
    """Tracks WebSocket connections held by *this* process, keyed by user id
    (as a string, to match the JSON coming back off Redis). A user can have
    more than one connection open (multiple tabs/devices), hence the set."""

    def __init__(self) -> None:
        self._connections: Dict[str, Set[WebSocket]] = defaultdict(set)

    async def connect(self, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[user_id].add(websocket)

    def disconnect(self, user_id: str, websocket: WebSocket) -> None:
        conns = self._connections.get(user_id)
        if not conns:
            return
        conns.discard(websocket)
        if not conns:
            self._connections.pop(user_id, None)

    async def send_to_local(self, user_id: str, payload: dict) -> None:
        """Push to every connection this process holds for user_id. A dead
        connection (send raises) is dropped rather than allowed to break
        delivery to the user's other connections."""
        for ws in list(self._connections.get(user_id, ())):
            try:
                await ws.send_json(payload)
            except Exception:
                self.disconnect(user_id, ws)

    def local_connection_count(self, user_id: str) -> int:
        return len(self._connections.get(user_id, ()))


manager = ConnectionManager()

_redis_client: Optional[aioredis.Redis] = None


def _get_redis_client() -> aioredis.Redis:
    """Lazily create a single shared Redis client for this process.

    redis-py's client manages its own connection pool internally, so one
    shared instance (not one per publish) is the intended usage.
    """
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(get_settings().redis_url, decode_responses=True)
    return _redis_client


async def _publish(recipient_id: str, notification: dict) -> None:
    try:
        client = _get_redis_client()
        await client.publish(CHANNEL, json.dumps({"recipient_id": recipient_id, "notification": notification}))
    except Exception:
        # Redis being unreachable (e.g. local dev without `docker compose up
        # redis`) must never take down the request that triggered this — the
        # Notification row is already safely committed either way. This is
        # purely a missed live-push; the client will still see it next time
        # it calls GET /notifications.
        logger.warning(
            "Failed to publish notification to Redis (recipient=%s) — realtime push skipped, "
            "row is still saved and will show up on next GET /notifications",
            recipient_id,
            exc_info=True,
        )


@event.listens_for(Session, "after_commit")
def _broadcast_after_commit(session: Session) -> None:
    """Fires after ANY session commits anywhere in the app — most commits
    have nothing queued, so this is a no-op for them. Only sessions that
    went through create_event_notification() (which stashes pending
    broadcasts on session.info) do anything here. Registered once, at
    import time, against the base Session class — AsyncSession delegates to
    a sync Session under the hood and these events still fire for it.
    """
    pending = session.info.pop("pending_notification_broadcasts", None)
    if not pending:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # No running event loop (e.g. a sync script/test committing outside
        # of the app) — nothing to schedule the push onto.
        return
    for item in pending:
        loop.create_task(_publish(item["recipient_id"], item["notification"]))


async def redis_subscriber_loop() -> None:
    """Run for the lifetime of the app (started in app.py's lifespan).
    Reconnects with a short backoff if Redis drops or was never reachable,
    rather than exiting — so it self-heals once Redis comes back without
    needing the app restarted.
    """
    while True:
        try:
            client = _get_redis_client()
            pubsub = client.pubsub()
            await pubsub.subscribe(CHANNEL)
            logger.info("Subscribed to Redis channel %r for realtime notifications", CHANNEL)
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    data = json.loads(message["data"])
                    await manager.send_to_local(data["recipient_id"], data["notification"])
                except Exception:
                    logger.warning("Failed to handle realtime notification message", exc_info=True)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("Redis subscriber loop lost connection, retrying in 5s", exc_info=True)
            await asyncio.sleep(5)

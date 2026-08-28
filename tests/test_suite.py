"""
Automated test suite for the Smart Task Management System API.

Covers (per AC-12 / implementation_plan.md Verification Plan):
  - Authentication: login, wrong password, locked user, refresh, change-password.
  - Project & Sprint Management: sprint date bounds, sprint overlap, closed project checks.
  - Task & Comment Management: status state machine, team member field restrictions.
  - Dashboard & Reporting: permission boundaries.
  - Notifications: scoping (user only sees own notifications).

Run with:
    python -m unittest tests.test_suite -v
"""
import json
import logging
import os
import re
import sys
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch, MagicMock, AsyncMock

# Most of this suite doesn't run against a live Redis (TestRealtimeNotifications
# mocks it explicitly where it matters — see that class). Every other test that
# happens to create a notification would otherwise print a full "Redis
# unreachable" warning+traceback (src/core/realtime.py's intentional, tested
# graceful-degradation path) — silence just that logger so real test failures
# aren't buried in expected noise.
logging.getLogger("realtime").setLevel(logging.CRITICAL)

# Ensure project root is importable and tests use an isolated sqlite DB.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
TEST_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "test_suite.db")
if os.path.exists(TEST_DB_PATH):
    os.remove(TEST_DB_PATH)
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{TEST_DB_PATH}"

from starlette.websockets import WebSocketDisconnect  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from src.app import app  # noqa: E402
from src.core.email import send_email  # noqa: E402
from src.core.realtime import manager as realtime_manager  # noqa: E402


class BaseAPITestCase(unittest.TestCase):
    """Shared TestClient (boots the app lifespan once, seeds the admin user)."""

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)

    def login(self, email, password):
        r = self.client.post("/api/v1/auth/login", json={"email": email, "password": password})
        return r

    def auth_headers(self, token):
        return {"Authorization": f"Bearer {token}"}

    def create_user(self, admin_headers, email, full_name, role, password="Password1"):
        r = self.client.post(
            "/api/v1/users",
            json={"email": email, "full_name": full_name, "password": password, "system_role": role},
            headers=admin_headers,
        )
        self.assertEqual(r.status_code, 201, r.text)
        return r.json()


class TestAuthentication(BaseAPITestCase):
    def test_admin_seed_login(self):
        r = self.login("admin@example.com", "Admin@123")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertIn("access_token", body)
        self.assertIn("refresh_token", body)
        self.assertEqual(body["expires_in"], 1800)
        self.assertEqual(body["user"]["email"], "admin@example.com")
        self.assertNotIn("password", body)
        self.assertNotIn("password_hash", body)

    def test_wrong_password_returns_401(self):
        r = self.login("admin@example.com", "wrong-password")
        self.assertEqual(r.status_code, 401)

    def test_nonexistent_email_returns_401_not_404(self):
        # AC-01: must not reveal whether the email exists
        r = self.login("nobody@example.com", "whatever123")
        self.assertEqual(r.status_code, 401)

    def test_locked_user_cannot_login(self):
        admin_token = self.login("admin@example.com", "Admin@123").json()["access_token"]
        admin_headers = self.auth_headers(admin_token)
        user = self.create_user(admin_headers, "locktest@example.com", "Lock Test", "TEAM_MEMBER")

        r = self.client.patch(f"/api/v1/users/{user['id']}/status", json={"status": "LOCKED"}, headers=admin_headers)
        self.assertEqual(r.status_code, 200)

        r = self.login("locktest@example.com", "Password1")
        self.assertEqual(r.status_code, 403)

    def test_refresh_token_rotates_and_old_token_rejected(self):
        r = self.login("admin@example.com", "Admin@123")
        refresh_token = r.json()["refresh_token"]

        r2 = self.client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
        self.assertEqual(r2.status_code, 200, r2.text)
        new_access = r2.json()["access_token"]
        self.assertTrue(new_access)

        # Reusing the rotated-out refresh token must fail
        r3 = self.client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
        self.assertEqual(r3.status_code, 401)

    def test_logout_works_without_access_token(self):
        # Logout must not require a valid/live access token — only the
        # refresh token (its own proof of ownership) is needed. This lets a
        # client log out even after its access token has already expired.
        r = self.login("admin@example.com", "Admin@123")
        refresh_token = r.json()["refresh_token"]

        r2 = self.client.post("/api/v1/auth/logout", json={"refresh_token": refresh_token})
        self.assertEqual(r2.status_code, 204, r2.text)

    def test_logout_revokes_refresh_token(self):
        r = self.login("admin@example.com", "Admin@123")
        refresh_token = r.json()["refresh_token"]

        r2 = self.client.post("/api/v1/auth/logout", json={"refresh_token": refresh_token})
        self.assertEqual(r2.status_code, 204, r2.text)

        # The now-revoked refresh token can no longer be used to get new tokens
        r3 = self.client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
        self.assertEqual(r3.status_code, 401)

    def test_refresh_token_reuse_revokes_all_sessions(self):
        # Two independent sessions (e.g. two devices) for the same user.
        session_a_refresh = self.login("admin@example.com", "Admin@123").json()["refresh_token"]
        session_b_refresh = self.login("admin@example.com", "Admin@123").json()["refresh_token"]

        # Rotate session A forward once — the original session_a_refresh is
        # now revoked (rotated-out), but session_b_refresh is still active.
        r_rotate = self.client.post("/api/v1/auth/refresh", json={"refresh_token": session_a_refresh})
        self.assertEqual(r_rotate.status_code, 200, r_rotate.text)

        # Presenting the already-rotated-out token again is treated as a
        # theft signal and must cascade: it revokes EVERY session for this
        # user, including the still-unused session_b_refresh.
        r_reuse = self.client.post("/api/v1/auth/refresh", json={"refresh_token": session_a_refresh})
        self.assertEqual(r_reuse.status_code, 401)

        r_session_b = self.client.post("/api/v1/auth/refresh", json={"refresh_token": session_b_refresh})
        self.assertEqual(
            r_session_b.status_code, 401,
            "reuse of a rotated-out refresh token should revoke all sessions for the user, "
            "not just the reused one",
        )

    def test_change_password_requires_current_password(self):
        admin_token = self.login("admin@example.com", "Admin@123").json()["access_token"]
        admin_headers = self.auth_headers(admin_token)
        user = self.create_user(admin_headers, "pwtest@example.com", "PW Test", "TEAM_MEMBER")
        token = self.login("pwtest@example.com", "Password1").json()["access_token"]
        headers = self.auth_headers(token)

        r = self.client.post(
            "/api/v1/auth/change-password",
            json={"current_password": "wrong", "new_password": "NewPassword1"},
            headers=headers,
        )
        self.assertEqual(r.status_code, 400)

        r2 = self.client.post(
            "/api/v1/auth/change-password",
            json={"current_password": "Password1", "new_password": "NewPassword1"},
            headers=headers,
        )
        self.assertEqual(r2.status_code, 200, r2.text)

        # Old password no longer works
        r3 = self.login("pwtest@example.com", "Password1")
        self.assertEqual(r3.status_code, 401)
        r4 = self.login("pwtest@example.com", "NewPassword1")
        self.assertEqual(r4.status_code, 200)


class TestForgotPassword(BaseAPITestCase):
    """Uses a dedicated per-test user (never the shared admin fixture) since
    these tests change the user's password and revoke their sessions —
    doing that to the shared admin account would break every other test
    class that logs in as admin@example.com."""

    def setUp(self):
        admin_token = self.login("admin@example.com", "Admin@123").json()["access_token"]
        self.admin_headers = self.auth_headers(admin_token)
        self.suffix = str(id(self))
        self.email = f"forgot{self.suffix}@example.com"
        self.create_user(self.admin_headers, self.email, "Forgot Pw", "TEAM_MEMBER", password="Password1")

    def _request_reset_and_capture_token(self, email):
        """POSTs /auth/forgot-password with send_email mocked out, and
        extracts the reset token from the link embedded in the email body
        (there's no real mail provider in tests — see src/core/email.py's
        dev fallback)."""
        captured = {}

        async def fake_send_email(to, subject, body):
            captured["to"] = to
            captured["subject"] = subject
            captured["body"] = body

        with patch("src.modules.auth.service.send_email", side_effect=fake_send_email):
            r = self.client.post("/api/v1/auth/forgot-password", json={"email": email})
        return r, captured

    def test_forgot_password_unknown_email_still_returns_204(self):
        # AC-01-style uniform response: must not reveal whether the email exists.
        r, captured = self._request_reset_and_capture_token("nobody-at-all@example.com")
        self.assertEqual(r.status_code, 204, r.text)
        self.assertEqual(captured, {})  # no email should have been sent

    def test_forgot_password_and_reset_flow(self):
        r, captured = self._request_reset_and_capture_token(self.email)
        self.assertEqual(r.status_code, 204, r.text)
        self.assertEqual(captured.get("to"), self.email)

        match = re.search(r"token=(\S+)", captured["body"])
        self.assertIsNotNone(match, captured.get("body"))
        token = match.group(1)

        r2 = self.client.post(
            "/api/v1/auth/reset-password",
            json={"token": token, "new_password": "BrandNewPassword1"},
        )
        self.assertEqual(r2.status_code, 204, r2.text)

        # Old password rejected, new password works
        self.assertEqual(self.login(self.email, "Password1").status_code, 401)
        self.assertEqual(self.login(self.email, "BrandNewPassword1").status_code, 200)

    def test_reset_token_cannot_be_reused(self):
        _, captured = self._request_reset_and_capture_token(self.email)
        token = re.search(r"token=(\S+)", captured["body"]).group(1)

        r1 = self.client.post(
            "/api/v1/auth/reset-password", json={"token": token, "new_password": "FirstNewPassword1"}
        )
        self.assertEqual(r1.status_code, 204, r1.text)

        r2 = self.client.post(
            "/api/v1/auth/reset-password", json={"token": token, "new_password": "SecondNewPassword1"}
        )
        self.assertEqual(r2.status_code, 400)

    def test_reset_with_garbage_token_rejected(self):
        r = self.client.post(
            "/api/v1/auth/reset-password",
            json={"token": "this-is-not-a-real-token", "new_password": "SomePassword1"},
        )
        self.assertEqual(r.status_code, 400)

    def test_reset_password_revokes_existing_sessions(self):
        login_resp = self.login(self.email, "Password1").json()
        refresh_token = login_resp["refresh_token"]

        _, captured = self._request_reset_and_capture_token(self.email)
        token = re.search(r"token=(\S+)", captured["body"]).group(1)

        r = self.client.post(
            "/api/v1/auth/reset-password", json={"token": token, "new_password": "AnotherNewPassword1"}
        )
        self.assertEqual(r.status_code, 204, r.text)

        # The refresh token from before the reset must no longer work.
        r2 = self.client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
        self.assertEqual(r2.status_code, 401)

    def test_forgot_password_email_failure_does_not_break_endpoint(self):
        # A real SMTP target (unlike the always-succeeds console dev
        # fallback) can fail to connect. forgot_password() must swallow
        # that and still return the uniform 204 — see the try/except around
        # send_email() in src/modules/auth/service.py.
        with patch(
            "src.modules.auth.service.send_email",
            side_effect=OSError("connection refused"),
        ):
            r = self.client.post("/api/v1/auth/forgot-password", json={"email": self.email})
        self.assertEqual(r.status_code, 204, r.text)


class TestEmailHelper(unittest.IsolatedAsyncioTestCase):
    """Unit tests for src/core/email.py's send_email() branching: dev
    fallback (no SMTP host at all) vs. sending to a no-auth relay like
    Mailpit (host set, no credentials) vs. sending through an authenticated
    provider (host + user + password). Mocks smtplib.SMTP directly rather
    than requiring a real server."""

    @staticmethod
    def _settings(**overrides):
        base = dict(
            smtp_host="", smtp_port=1025, smtp_user="", smtp_password="",
            smtp_from="", smtp_use_tls=False,
        )
        base.update(overrides)
        return SimpleNamespace(**base)

    @staticmethod
    def _mock_smtp_instance():
        """smtplib.SMTP is used as a context manager (`with smtplib.SMTP(...) as server`);
        build a MagicMock that supports that and returns a separate mock for
        `server` so calls like server.login(...) can be asserted on."""
        server = MagicMock()
        instance = MagicMock()
        instance.__enter__ = MagicMock(return_value=server)
        instance.__exit__ = MagicMock(return_value=False)
        return instance, server

    async def test_dev_fallback_when_smtp_host_unset(self):
        with patch("src.core.email.get_settings", return_value=self._settings(smtp_host="")):
            with patch("src.core.email.smtplib.SMTP") as mock_smtp_cls:
                await send_email(to="user@example.com", subject="Hi", body="Body")
        mock_smtp_cls.assert_not_called()

    async def test_sends_without_login_to_noauth_relay(self):
        # Mirrors the mailpit docker-compose service: host set, no user/password.
        settings = self._settings(smtp_host="mailpit", smtp_port=1025, smtp_use_tls=False)
        instance, server = self._mock_smtp_instance()
        with patch("src.core.email.get_settings", return_value=settings):
            with patch("src.core.email.smtplib.SMTP", return_value=instance) as mock_smtp_cls:
                await send_email(to="user@example.com", subject="Hi", body="Body")
        mock_smtp_cls.assert_called_once_with("mailpit", 1025, timeout=10)
        server.starttls.assert_not_called()
        server.login.assert_not_called()
        server.sendmail.assert_called_once()

    async def test_sends_with_login_when_credentials_present(self):
        settings = self._settings(
            smtp_host="smtp.example.com", smtp_port=587,
            smtp_user="user", smtp_password="pass", smtp_use_tls=True,
        )
        instance, server = self._mock_smtp_instance()
        with patch("src.core.email.get_settings", return_value=settings):
            with patch("src.core.email.smtplib.SMTP", return_value=instance):
                await send_email(to="user@example.com", subject="Hi", body="Body")
        server.starttls.assert_called_once()
        server.login.assert_called_once_with("user", "pass")
        server.sendmail.assert_called_once()


class TestProjectAndSprint(BaseAPITestCase):
    def setUp(self):
        admin_token = self.login("admin@example.com", "Admin@123").json()["access_token"]
        self.admin_headers = self.auth_headers(admin_token)
        suffix = str(id(self))
        self.pm = self.create_user(self.admin_headers, f"pm{suffix}@example.com", "PM", "PROJECT_MANAGER")
        self.pm_headers = self.auth_headers(self.login(f"pm{suffix}@example.com", "Password1").json()["access_token"])

        r = self.client.post(
            "/api/v1/projects",
            json={
                "code": f"PRJ{suffix}",
                "name": "Test Project",
                "start_date": "2026-01-01",
                "end_date": "2026-06-30",
            },
            headers=self.pm_headers,
        )
        self.assertEqual(r.status_code, 201, r.text)
        self.project = r.json()

    def test_project_end_date_before_start_date_rejected_on_create(self):
        r = self.client.post(
            "/api/v1/projects",
            json={
                "code": f"BADPRJ{id(self)}",
                "name": "Bad Project",
                "start_date": "2026-06-30",
                "end_date": "2026-01-01",
            },
            headers=self.pm_headers,
        )
        self.assertEqual(r.status_code, 422, r.text)

    def test_project_end_date_before_start_date_rejected_on_update(self):
        # self.project (from setUp) has start_date=2026-01-01, end_date=2026-06-30.
        # Only touching end_date must still be validated against the existing start_date.
        r = self.client.patch(
            f"/api/v1/projects/{self.project['id']}",
            json={"end_date": "2025-12-01"},
            headers=self.pm_headers,
        )
        self.assertEqual(r.status_code, 400, r.text)

    def test_sprint_within_project_bounds_ok(self):
        r = self.client.post(
            f"/api/v1/projects/{self.project['id']}/sprints",
            json={"name": "Sprint A", "start_date": "2026-01-05", "end_date": "2026-01-19"},
            headers=self.pm_headers,
        )
        self.assertEqual(r.status_code, 201, r.text)

    def test_sprint_outside_project_bounds_rejected(self):
        r = self.client.post(
            f"/api/v1/projects/{self.project['id']}/sprints",
            json={"name": "Sprint Out", "start_date": "2025-12-01", "end_date": "2025-12-14"},
            headers=self.pm_headers,
        )
        self.assertEqual(r.status_code, 400)

    def test_sprint_start_after_end_rejected_by_schema(self):
        r = self.client.post(
            f"/api/v1/projects/{self.project['id']}/sprints",
            json={"name": "Bad Sprint", "start_date": "2026-02-01", "end_date": "2026-01-01"},
            headers=self.pm_headers,
        )
        self.assertEqual(r.status_code, 422)

    def test_overlapping_active_sprints_rejected(self):
        r1 = self.client.post(
            f"/api/v1/projects/{self.project['id']}/sprints",
            json={"name": "Sprint 1", "start_date": "2026-01-05", "end_date": "2026-01-19"},
            headers=self.pm_headers,
        )
        sprint1_id = r1.json()["id"]
        self.client.patch(
            f"/api/v1/projects/{self.project['id']}/sprints/{sprint1_id}",
            json={"status": "ACTIVE"},
            headers=self.pm_headers,
        )

        # Overlapping date range while Sprint 1 is ACTIVE must be rejected
        r2 = self.client.post(
            f"/api/v1/projects/{self.project['id']}/sprints",
            json={"name": "Sprint 2 overlap", "start_date": "2026-01-15", "end_date": "2026-01-25"},
            headers=self.pm_headers,
        )
        self.assertEqual(r2.status_code, 400)

    def test_second_active_sprint_rejected_even_without_date_overlap(self):
        # UC-05 rule: at most one ACTIVE sprint per project at a time, even if
        # the two sprints' date ranges don't overlap at all.
        r1 = self.client.post(
            f"/api/v1/projects/{self.project['id']}/sprints",
            json={"name": "Sprint Jan", "start_date": "2026-01-05", "end_date": "2026-01-19"},
            headers=self.pm_headers,
        )
        sprint1_id = r1.json()["id"]
        r2 = self.client.post(
            f"/api/v1/projects/{self.project['id']}/sprints",
            json={"name": "Sprint Mar", "start_date": "2026-03-01", "end_date": "2026-03-14"},
            headers=self.pm_headers,
        )
        sprint2_id = r2.json()["id"]

        r_activate_1 = self.client.patch(
            f"/api/v1/projects/{self.project['id']}/sprints/{sprint1_id}",
            json={"status": "ACTIVE"},
            headers=self.pm_headers,
        )
        self.assertEqual(r_activate_1.status_code, 200, r_activate_1.text)

        r_activate_2 = self.client.patch(
            f"/api/v1/projects/{self.project['id']}/sprints/{sprint2_id}",
            json={"status": "ACTIVE"},
            headers=self.pm_headers,
        )
        self.assertEqual(r_activate_2.status_code, 400, r_activate_2.text)

    def test_closed_project_blocks_new_sprint_and_task(self):
        r = self.client.patch(
            f"/api/v1/projects/{self.project['id']}", json={"status": "CLOSED"}, headers=self.pm_headers
        )
        self.assertEqual(r.status_code, 200, r.text)

        r_sprint = self.client.post(
            f"/api/v1/projects/{self.project['id']}/sprints",
            json={"name": "Sprint After Close", "start_date": "2026-01-05", "end_date": "2026-01-19"},
            headers=self.pm_headers,
        )
        self.assertEqual(r_sprint.status_code, 400)

        r_task = self.client.post(
            f"/api/v1/projects/{self.project['id']}/tasks",
            json={"title": "Should fail", "priority": "LOW"},
            headers=self.pm_headers,
        )
        self.assertEqual(r_task.status_code, 400)

    def test_remove_member_with_open_tasks_requires_reassignment(self):
        suffix = str(id(self))
        tm = self.create_user(self.admin_headers, f"tm{suffix}@example.com", "TM", "TEAM_MEMBER")
        tm2 = self.create_user(self.admin_headers, f"tm2{suffix}@example.com", "TM2", "TEAM_MEMBER")

        self.client.post(
            f"/api/v1/projects/{self.project['id']}/members",
            json={"user_id": tm["id"], "project_role": "MEMBER"},
            headers=self.pm_headers,
        )
        self.client.post(
            f"/api/v1/projects/{self.project['id']}/members",
            json={"user_id": tm2["id"], "project_role": "MEMBER"},
            headers=self.pm_headers,
        )

        r_task = self.client.post(
            f"/api/v1/projects/{self.project['id']}/tasks",
            json={"title": "Open task", "priority": "LOW", "assignee_id": tm["id"]},
            headers=self.pm_headers,
        )
        self.assertEqual(r_task.status_code, 201, r_task.text)

        # Removing without reassignment must fail while an open task exists
        r_remove = self.client.request(
            "DELETE",
            f"/api/v1/projects/{self.project['id']}/members/{tm['id']}",
            json={},
            headers=self.pm_headers,
        )
        self.assertEqual(r_remove.status_code, 400)

        # Removing with a valid reassignment target succeeds
        r_remove_ok = self.client.request(
            "DELETE",
            f"/api/v1/projects/{self.project['id']}/members/{tm['id']}",
            json={"reassign_to_user_id": tm2["id"]},
            headers=self.pm_headers,
        )
        self.assertEqual(r_remove_ok.status_code, 204, r_remove_ok.text)


class TestTaskStateMachineAndPermissions(BaseAPITestCase):
    def setUp(self):
        admin_token = self.login("admin@example.com", "Admin@123").json()["access_token"]
        self.admin_headers = self.auth_headers(admin_token)
        suffix = str(id(self))
        self.pm = self.create_user(self.admin_headers, f"pmt{suffix}@example.com", "PM", "PROJECT_MANAGER")
        self.pm_headers = self.auth_headers(self.login(f"pmt{suffix}@example.com", "Password1").json()["access_token"])
        self.tm = self.create_user(self.admin_headers, f"tmt{suffix}@example.com", "TM", "TEAM_MEMBER")
        self.tm_headers = self.auth_headers(self.login(f"tmt{suffix}@example.com", "Password1").json()["access_token"])

        self.project = self.client.post(
            "/api/v1/projects",
            json={"code": f"TPRJ{suffix}", "name": "Task Project"},
            headers=self.pm_headers,
        ).json()

        self.client.post(
            f"/api/v1/projects/{self.project['id']}/members",
            json={"user_id": self.tm["id"], "project_role": "MEMBER"},
            headers=self.pm_headers,
        )

        self.task = self.client.post(
            f"/api/v1/projects/{self.project['id']}/tasks",
            json={"title": "Do the thing", "priority": "HIGH", "assignee_id": self.tm["id"]},
            headers=self.pm_headers,
        ).json()

    def test_due_date_with_timezone_offset_is_accepted(self):
        # Regression test: a client sending due_date as an ISO string with a
        # "Z"/offset suffix (e.g. "...T03:47:43.118Z") used to parse into a
        # timezone-AWARE datetime that SQLite tolerated but Postgres/asyncpg
        # rejected with "can't subtract offset-naive and offset-aware
        # datetimes", since the due_date column is TIMESTAMP WITHOUT TIME
        # ZONE. TaskCreate/TaskUpdate now normalize due_date to naive UTC,
        # so this must succeed (not 500) regardless of backend.
        r = self.client.post(
            f"/api/v1/projects/{self.project['id']}/tasks",
            json={
                "title": "Task with tz-aware due date",
                "priority": "HIGH",
                "due_date": "2026-08-27T03:47:43.118Z",
            },
            headers=self.pm_headers,
        )
        self.assertEqual(r.status_code, 201, r.text)
        # "Z" == UTC, so the naive value stored/returned should match the
        # wall-clock time as given, just without the offset suffix.
        self.assertTrue(r.json()["due_date"].startswith("2026-08-27T03:47:43.118"))

    def test_valid_transition_todo_to_in_progress(self):
        r = self.client.patch(
            f"/api/v1/tasks/{self.task['id']}/status", json={"status": "IN_PROGRESS"}, headers=self.tm_headers
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["previous_status"], "TODO")
        self.assertEqual(r.json()["status"], "IN_PROGRESS")

    def test_invalid_transition_todo_to_done_rejected_with_code(self):
        r = self.client.patch(
            f"/api/v1/tasks/{self.task['id']}/status", json={"status": "DONE"}, headers=self.tm_headers
        )
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()["detail"]["code"], "INVALID_STATUS_TRANSITION")

    def test_team_member_cannot_change_disallowed_fields(self):
        r = self.client.patch(
            f"/api/v1/tasks/{self.task['id']}", json={"priority": "LOW"}, headers=self.tm_headers
        )
        self.assertEqual(r.status_code, 403)

    def test_team_member_can_change_allowed_fields(self):
        r = self.client.patch(
            f"/api/v1/tasks/{self.task['id']}", json={"description": "progress notes"}, headers=self.tm_headers
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["description"], "progress notes")

    def test_completed_at_set_on_done_and_cleared_on_leaving_done(self):
        self.client.patch(f"/api/v1/tasks/{self.task['id']}/status", json={"status": "IN_PROGRESS"}, headers=self.tm_headers)
        self.client.patch(f"/api/v1/tasks/{self.task['id']}/status", json={"status": "IN_REVIEW"}, headers=self.tm_headers)
        r = self.client.patch(f"/api/v1/tasks/{self.task['id']}/status", json={"status": "DONE"}, headers=self.pm_headers)
        self.assertEqual(r.status_code, 200, r.text)

        r2 = self.client.patch(f"/api/v1/tasks/{self.task['id']}", json={"status": "TODO"}, headers=self.pm_headers)
        self.assertEqual(r2.status_code, 200, r2.text)
        self.assertIsNone(r2.json()["completed_at"])

    def test_comment_created_and_visible(self):
        r = self.client.post(
            f"/api/v1/tasks/{self.task['id']}/comments", json={"content": "hello"}, headers=self.tm_headers
        )
        self.assertEqual(r.status_code, 201, r.text)

        r_empty = self.client.post(
            f"/api/v1/tasks/{self.task['id']}/comments", json={"content": "   "}, headers=self.tm_headers
        )
        self.assertEqual(r_empty.status_code, 422)

        r_list = self.client.get(f"/api/v1/tasks/{self.task['id']}/comments", headers=self.tm_headers)
        self.assertEqual(r_list.status_code, 200)
        self.assertGreaterEqual(len(r_list.json()), 1)


class TestDashboardAndReportingPermissions(BaseAPITestCase):
    def setUp(self):
        admin_token = self.login("admin@example.com", "Admin@123").json()["access_token"]
        self.admin_headers = self.auth_headers(admin_token)
        suffix = str(id(self))
        self.pm_headers = self.auth_headers(
            self.login(
                self.create_user(self.admin_headers, f"dpm{suffix}@example.com", "PM", "PROJECT_MANAGER")["email"],
                "Password1",
            ).json()["access_token"]
        )
        self.tm_headers = self.auth_headers(
            self.login(
                self.create_user(self.admin_headers, f"dtm{suffix}@example.com", "TM", "TEAM_MEMBER")["email"],
                "Password1",
            ).json()["access_token"]
        )
        self.project = self.client.post(
            "/api/v1/projects",
            json={"code": f"DPRJ{suffix}", "name": "Dash Project"},
            headers=self.pm_headers,
        ).json()

    def test_dashboard_forbidden_for_non_member(self):
        r = self.client.get(f"/api/v1/dashboard/projects/{self.project['id']}", headers=self.tm_headers)
        self.assertEqual(r.status_code, 403)

    def test_dashboard_empty_project_returns_zeroes_not_error(self):
        r = self.client.get(f"/api/v1/dashboard/projects/{self.project['id']}", headers=self.pm_headers)
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["summary"]["total_tasks"], 0)
        self.assertEqual(body["summary"]["completion_rate"], 0.0)

    def test_reporting_forbidden_for_team_member(self):
        r = self.client.get("/api/v1/reports/tasks/csv", headers=self.tm_headers)
        self.assertEqual(r.status_code, 403)

    def test_reporting_allowed_for_project_manager(self):
        r = self.client.get("/api/v1/reports/tasks/csv", headers=self.pm_headers)
        self.assertEqual(r.status_code, 200)
        self.assertIn("text/csv", r.headers["content-type"])


class TestNotificationScoping(BaseAPITestCase):
    def test_user_only_sees_own_notifications(self):
        admin_token = self.login("admin@example.com", "Admin@123").json()["access_token"]
        admin_headers = self.auth_headers(admin_token)
        suffix = str(id(self))
        pm = self.create_user(admin_headers, f"npm{suffix}@example.com", "PM", "PROJECT_MANAGER")
        pm_headers = self.auth_headers(self.login(pm["email"], "Password1").json()["access_token"])
        tm = self.create_user(admin_headers, f"ntm{suffix}@example.com", "TM", "TEAM_MEMBER")
        tm_headers = self.auth_headers(self.login(tm["email"], "Password1").json()["access_token"])

        project = self.client.post(
            "/api/v1/projects", json={"code": f"NPRJ{suffix}", "name": "Notif Project"}, headers=pm_headers
        ).json()
        self.client.post(
            f"/api/v1/projects/{project['id']}/members",
            json={"user_id": tm["id"], "project_role": "MEMBER"},
            headers=pm_headers,
        )
        self.client.post(
            f"/api/v1/projects/{project['id']}/tasks",
            json={"title": "Notify me", "priority": "LOW", "assignee_id": tm["id"]},
            headers=pm_headers,
        )

        r_tm = self.client.get("/api/v1/notifications", headers=tm_headers)
        self.assertEqual(r_tm.status_code, 200)
        self.assertTrue(all(item["recipient_id"] == tm["id"] for item in r_tm.json()["items"]))

        r_pm = self.client.get("/api/v1/notifications", headers=pm_headers)
        self.assertEqual(r_pm.status_code, 200)
        # PM created the task themself, so should not have a TASK_ASSIGNED notif about it
        self.assertTrue(all(item["recipient_id"] == pm["id"] for item in r_pm.json()["items"]))


class TestRealtimeNotifications(BaseAPITestCase):
    """Covers src/core/realtime.py's two halves: (1) the WebSocket endpoint
    itself — auth, and that it registers/deregisters in the in-process
    ConnectionManager — and (2) that creating a notification schedules a
    Redis publish once its transaction commits. Neither test needs a real
    Redis running: (1) never involves Redis at all (it only exercises local
    connection bookkeeping), and (2) mocks `_get_redis_client` the same way
    `TestEmailHelper` mocks smtplib — this suite should pass identically
    whether or not `docker compose up redis` happened to be running."""

    def setUp(self):
        admin_token = self.login("admin@example.com", "Admin@123").json()["access_token"]
        self.admin_headers = self.auth_headers(admin_token)
        self.suffix = str(id(self))
        self.member = self.create_user(
            self.admin_headers, f"rt{self.suffix}@example.com", "Realtime Member", "TEAM_MEMBER"
        )
        self.member_token = self.login(self.member["email"], "Password1").json()["access_token"]

    def test_websocket_rejects_invalid_token(self):
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/api/v1/notifications/ws?token=not-a-real-token"):
                pass

    def test_websocket_connect_registers_and_disconnect_deregisters(self):
        user_id = self.member["id"]
        self.assertEqual(realtime_manager.local_connection_count(user_id), 0)

        with self.client.websocket_connect(f"/api/v1/notifications/ws?token={self.member_token}"):
            self.assertEqual(realtime_manager.local_connection_count(user_id), 1)

        self.assertEqual(realtime_manager.local_connection_count(user_id), 0)

    def test_notification_creation_publishes_to_redis_after_commit(self):
        # Same setup as TestNotificationScoping: PM creates a project, adds
        # a team member, then assigns them a task — that last step is what
        # calls create_event_notification() + commits.
        pm = self.create_user(self.admin_headers, f"rtpm{self.suffix}@example.com", "RT PM", "PROJECT_MANAGER")
        pm_headers = self.auth_headers(self.login(pm["email"], "Password1").json()["access_token"])

        project = self.client.post(
            "/api/v1/projects", json={"code": f"RTPRJ{self.suffix}", "name": "Realtime Project"}, headers=pm_headers
        ).json()
        self.client.post(
            f"/api/v1/projects/{project['id']}/members",
            json={"user_id": self.member["id"], "project_role": "MEMBER"},
            headers=pm_headers,
        )

        fake_redis_client = MagicMock()
        fake_redis_client.publish = AsyncMock()

        with patch("src.core.realtime._get_redis_client", return_value=fake_redis_client):
            r = self.client.post(
                f"/api/v1/projects/{project['id']}/tasks",
                json={"title": "Realtime Task", "priority": "MEDIUM", "assignee_id": self.member["id"]},
                headers=pm_headers,
            )
            self.assertEqual(r.status_code, 201, r.text)

            # The publish is scheduled as an asyncio task from a sync
            # SQLAlchemy `after_commit` event (see _broadcast_after_commit
            # in src/core/realtime.py) rather than awaited inline, so it can
            # run slightly after the HTTP response is already back. A short
            # wait here (in this test's own thread — TestClient runs the
            # app on a separate thread/loop, so this doesn't block it) gives
            # that scheduled task room to execute before we assert on it.
            for _ in range(50):
                if fake_redis_client.publish.await_count:
                    break
                time.sleep(0.02)

        fake_redis_client.publish.assert_awaited_once()
        channel, raw_payload = fake_redis_client.publish.await_args.args
        self.assertEqual(channel, "notifications")
        payload = json.loads(raw_payload)
        self.assertEqual(payload["recipient_id"], self.member["id"])
        self.assertEqual(payload["notification"]["type"], "TASK_ASSIGNED")


class TestProjectAndUserSearch(BaseAPITestCase):
    """FR-07: Project and User search must support filter, sort, and
    pagination — the same guarantees Task search already had."""

    def setUp(self):
        admin_token = self.login("admin@example.com", "Admin@123").json()["access_token"]
        self.admin_headers = self.auth_headers(admin_token)
        self.suffix = str(id(self))

        self.pm = self.create_user(
            self.admin_headers,
            f"searchpm{self.suffix}@example.com",
            f"Search PM {self.suffix}",
            "PROJECT_MANAGER",
        )
        self.pm_headers = self.auth_headers(
            self.login(self.pm["email"], "Password1").json()["access_token"]
        )

        # Two projects owned/managed by the same PM: one PLANNING, one CLOSED,
        # with distinguishable codes/names for search-pattern matching.
        self.proj_alpha = self.client.post(
            "/api/v1/projects",
            json={"code": f"ALPHA{self.suffix}", "name": f"Alpha Rollout {self.suffix}"},
            headers=self.pm_headers,
        ).json()
        self.proj_beta = self.client.post(
            "/api/v1/projects",
            json={"code": f"BETA{self.suffix}", "name": f"Beta Rollout {self.suffix}"},
            headers=self.pm_headers,
        ).json()
        r = self.client.patch(
            f"/api/v1/projects/{self.proj_beta['id']}", json={"status": "CLOSED"}, headers=self.pm_headers
        )
        self.assertEqual(r.status_code, 200, r.text)

    def test_project_search_by_name_or_code(self):
        r = self.client.get(
            "/api/v1/projects", params={"search": f"Alpha Rollout {self.suffix}"}, headers=self.pm_headers
        )
        self.assertEqual(r.status_code, 200, r.text)
        codes = [p["code"] for p in r.json()["items"]]
        self.assertIn(self.proj_alpha["code"], codes)
        self.assertNotIn(self.proj_beta["code"], codes)

    def test_project_filter_by_status(self):
        r = self.client.get("/api/v1/projects", params={"status": "CLOSED"}, headers=self.pm_headers)
        self.assertEqual(r.status_code, 200, r.text)
        codes = [p["code"] for p in r.json()["items"]]
        self.assertIn(self.proj_beta["code"], codes)
        self.assertNotIn(self.proj_alpha["code"], codes)

    def test_project_sort_by_code_ascending(self):
        r = self.client.get(
            "/api/v1/projects",
            params={"search": self.suffix, "sort_by": "+code"},
            headers=self.pm_headers,
        )
        self.assertEqual(r.status_code, 200, r.text)
        codes = [p["code"] for p in r.json()["items"]]
        self.assertEqual(codes, sorted(codes))

    def test_project_pagination(self):
        r = self.client.get(
            "/api/v1/projects",
            params={"search": self.suffix, "page": 1, "page_size": 1},
            headers=self.pm_headers,
        )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["pagination"]["page"], 1)
        self.assertEqual(body["pagination"]["page_size"], 1)
        self.assertGreaterEqual(body["pagination"]["total_items"], 2)
        self.assertGreaterEqual(body["pagination"]["total_pages"], 2)

    def test_project_invalid_sort_field_rejected(self):
        r = self.client.get(
            "/api/v1/projects", params={"sort_by": "not_a_real_field"}, headers=self.pm_headers
        )
        self.assertEqual(r.status_code, 422)

    def test_user_search_by_name_or_email(self):
        r = self.client.get(
            "/api/v1/users", params={"search": f"Search PM {self.suffix}"}, headers=self.admin_headers
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(any(u["id"] == self.pm["id"] for u in r.json()["items"]))

    def test_user_filter_by_role(self):
        r = self.client.get(
            "/api/v1/users",
            params={"role": "PROJECT_MANAGER", "search": self.suffix},
            headers=self.admin_headers,
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(all(u["system_role"] == "PROJECT_MANAGER" for u in r.json()["items"]))
        self.assertTrue(any(u["id"] == self.pm["id"] for u in r.json()["items"]))

    def test_user_pagination(self):
        r = self.client.get(
            "/api/v1/users", params={"page": 1, "page_size": 1}, headers=self.admin_headers
        )
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(len(body["items"]), 1)
        self.assertEqual(body["pagination"]["page_size"], 1)
        self.assertGreaterEqual(body["pagination"]["total_items"], 2)  # at least admin + this PM

    def test_user_invalid_sort_field_rejected(self):
        r = self.client.get(
            "/api/v1/users", params={"sort_by": "password_hash"}, headers=self.admin_headers
        )
        self.assertEqual(r.status_code, 422)


if __name__ == "__main__":
    unittest.main()

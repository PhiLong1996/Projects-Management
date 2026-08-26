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
import os
import sys
import unittest

# Ensure project root is importable and tests use an isolated sqlite DB.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
TEST_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "test_suite.db")
if os.path.exists(TEST_DB_PATH):
    os.remove(TEST_DB_PATH)
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{TEST_DB_PATH}"

from fastapi.testclient import TestClient  # noqa: E402
from src.app import app  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()

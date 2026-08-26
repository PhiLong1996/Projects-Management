# Implementation Plan - Aligning Smart Task Management System with Requirements

This plan details the steps to audit and correct the FastAPI codebase to fully meet the functional and non-functional requirements specified in `Mock Project_Smart Task Management System (1).pdf`.

## User Review Required

> [!IMPORTANT]
> - **Initial Database State:** Seeding of a default Administrator user (`admin@example.com` / `Admin@123`) will be added to the lifespan startup to allow initial logins, as the database is otherwise empty and user creation is restricted.
> - **Notification Scheduled Jobs:** A new standalone script `src/jobs/check_deadlines.py` will be created. It should be scheduled as a cron job to periodically run the deadline approaching and task overdue checks.

## Proposed Changes

---

### Core & Configuration

#### [MODIFY] [config.py](file:///c:/Users/DELL/Downloads/TaskManagementProject/src/config.py)
- Add settings for `admin_email` and `admin_password` to the `Settings` class (defaults: `admin@example.com` and `Admin@123`).

#### [MODIFY] [app.py](file:///c:/Users/DELL/Downloads/TaskManagementProject/src/app.py)
- Import and register all missing routers: `users_router`, `notifications_router`, `comments_router`, and `tasks_search_router`.
- Implement a startup seed function inside the lifespan context manager: check if the `User` table has any records; if empty, create a default Administrator user.

---

### Authentication Module

#### [MODIFY] [schemas.py](file:///c:/Users/DELL/Downloads/TaskManagementProject/src/modules/auth/schemas.py)
- Add `TokenUserResponse` containing `id`, `email`, `full_name`, and `system_role`.
- Update `TokenResponse` to include `expires_in: int` and `user: TokenUserResponse` as required by Section 14.2 of the spec.

#### [MODIFY] [router.py](file:///c:/Users/DELL/Downloads/TaskManagementProject/src/modules/auth/router.py)
- Update `login` and `refresh_token` endpoints to return the full payload matching Section 14.2 (including `expires_in=1800` and the user profile fields).

---

### Users Module

#### [MODIFY] [router.py](file:///c:/Users/DELL/Downloads/TaskManagementProject/src/modules/users/router.py)
- Update `list_users` to allow access to Administrators, Project Managers, and Team Members (AC-02 & Section 12 Matrix).
  - Scope list/search: Administrator sees all users; Project Managers and Team Members see only users who share at least one project with them.
  - Add optional filters: `search` (searches full_name/email), `status` (ACTIVE/LOCKED/INACTIVE), and `role` (ADMIN/PROJECT_MANAGER/TEAM_MEMBER).
- Add endpoint `PATCH /users/{user_id}` for updating user profile information (email and full_name). Validate email uniqueness and normalization.

---

### Project & Sprint Modules

#### [MODIFY] [router.py](file:///c:/Users/DELL/Downloads/TaskManagementProject/src/modules/sprints/router.py)
- Add verification that Sprint dates:
  1. Do not overlap with other active Sprints in the project.
  2. Are within the Project's start/end dates (if set).

#### [MODIFY] [router.py](file:///c:/Users/DELL/Downloads/TaskManagementProject/src/modules/projects/router.py)
- Trigger `PROJECT_MEMBER_ADDED` notification when a user is successfully added/reactivated in a project.

---

### Tasks & Comments Module

#### [MODIFY] [models.py](file:///c:/Users/DELL/Downloads/TaskManagementProject/src/modules/comments/models.py)
- Define `Attachment` model matching the spec's Section 13.7 (using fields: `id`, `task_id`, `uploaded_by`, `original_name`, `storage_key`, `content_type`, `size_bytes`, `created_at`).

#### [MODIFY] [schemas.py](file:///c:/Users/DELL/Downloads/TaskManagementProject/src/modules/tasks/schemas.py)
- Update `AttachmentResponse` to match Section 13.7 field names.

#### [MODIFY] [router.py](file:///c:/Users/DELL/Downloads/TaskManagementProject/src/modules/comments/router.py)
- Fix imports: load `MAX_FILE_SIZE_BYTES`, `ALLOWED_MIME_TYPES`, `ALLOWED_EXTENSIONS` from `src.config` (using settings) and import `Comment`/`Attachment` from the correct models file.
- Update `upload_attachment` path to save using the adjusted `Attachment` model fields.
- Add `GET /tasks/{task_id}/comments` and `GET /tasks/{task_id}/attachments` endpoints.
- Trigger `COMMENT_ADDED` notification when a comment is created.

#### [MODIFY] [router.py](file:///c:/Users/DELL/Downloads/TaskManagementProject/src/modules/tasks/router.py)
- Implement status transition validation logic:
  - Valid transitions:
    - `TODO` -> `IN_PROGRESS` or `CANCELLED`
    - `IN_PROGRESS` -> `TODO`, `IN_REVIEW`, or `CANCELLED`
    - `IN_REVIEW` -> `TODO`, `IN_PROGRESS`, `DONE`, or `CANCELLED`
    - `DONE` -> `TODO` or `IN_PROGRESS`
    - `CANCELLED` -> `TODO`
  - Throw 409 Conflict with code `INVALID_STATUS_TRANSITION` on invalid transitions.
- Restrict Team Members from updating fields other than `status`, `description`, and `actual_hours`.
- Add endpoint `PATCH /tasks/{task_id}/status` returning: `id`, `previous_status`, `status`, and `updated_at` (Section 14.5).
- Add notification triggers:
  - `TASK_ASSIGNED` (on creation/assignment)
  - `TASK_REASSIGNED` (on assignee change, notifies both new and old assignees)
  - `TASK_STATUS_CHANGED` (on status change, notifies assignee and reporter, excludes actor)
  - `TASK_UPDATED` (on priority/due_date change, notifies assignee)

---

### Dashboard Module

#### [MODIFY] [schemas.py](file:///c:/Users/DELL/Downloads/TaskManagementProject/src/modules/dashboard/schemas.py)
- Re-declare `DashboardStatsResponse` matching Section 14.7 schema.

#### [MODIFY] [router.py](file:///c:/Users/DELL/Downloads/TaskManagementProject/src/modules/dashboard/router.py)
- Change route path to `GET /dashboard/projects/{project_id}?sprint_id={sprint_id}`.
- Calculate and format response precisely:
  - `scope`: `project_id`, `sprint_id`
  - `summary`: `total_tasks`, `completed_tasks`, `overdue_tasks`, `completion_rate` (percentage)
  - `tasks_by_status`: list of status objects with counts.
  - `tasks_by_priority`: list of priority objects with counts.

---

### Reporting Module

#### [MODIFY] [router.py](file:///c:/Users/DELL/Downloads/TaskManagementProject/src/modules/reporting/router.py)
- Add optional `sprint_id` filter.
- Limit endpoint access to:
  - Administrators (all projects).
  - Project Managers (only projects they manage).
  - Team Members: Reject with 403 Forbidden.

---

### Notifications Module

#### [MODIFY] [models.py](file:///c:/Users/DELL/Downloads/TaskManagementProject/src/modules/notifications/models.py)
- Add `deduplication_key` field to the `Notification` model.

#### [MODIFY] [router.py](file:///c:/Users/DELL/Downloads/TaskManagementProject/src/modules/notifications/router.py)
- Correct `create_event_notification` to accept and write all fields (`type`, `entity_type`, `entity_id`, and `deduplication_key`).
- Update `GET /notifications` to support pagination (`page` and `page_size`) and filtering by `is_read`.
- Implement `PATCH /notifications/{notification_id}/read` (sets `is_read=True` and `read_at`).
- Implement `PATCH /notifications/read-all` (sets `is_read=True` and `read_at` for all notifications of the user).

#### [NEW] [check_deadlines.py](file:///c:/Users/DELL/Downloads/TaskManagementProject/src/jobs/check_deadlines.py)
- Script to run checks and trigger `DEADLINE_APPROACHING` (24h before due) and `TASK_OVERDUE` (overdue) notifications idempotently.

---

## Verification Plan

### Automated Tests
We will write a comprehensive unit test suite in `tests/test_suite.py` to cover:
- Authentication (login, refresh, password change, locked users).
- Project & Sprint Management (sprint date bounds, sprints overlap, closed project checks).
- Task & Comment Management (state machine transitions, team member field restrictions, attachment restrictions).
- Dashboard & Reporting (exact schema matching, permissions).
- Notifications (scoping, read/unread APIs, event trigger checks).

We will execute the tests using:
`python -m unittest tests/test_suite.py`

### Manual Verification
- We will boot the FastAPI app using `uvicorn src.app:app --reload` and check the `/docs` Swagger UI to verify all routes are listed and functional.

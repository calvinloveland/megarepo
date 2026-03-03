# Shared Web Systems

Reusable components shared by multiple web apps in this directory.

## Feedback system

- Backend module: `src/web_feedback/`
- Shared widget template: `templates/_shared_feedback.html`
- Routes provided to apps:
  - `POST /feedback`
  - `GET /feedback` (basic auth via `FEEDBACK_ADMIN_USERNAME` and `FEEDBACK_ADMIN_PASSWORD`)
  - `POST /feedback/mark-addressed`

Apps enable this system via `enable_shared_feedback(...)` and keep their data in each app's `data/feedback/` directory.

Saved feedback items include context fields:
- `app` (server-defined app name)
- `page_path` (client page path)
- `page_title` (client page title)

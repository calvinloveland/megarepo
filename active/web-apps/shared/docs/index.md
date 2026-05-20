# Shared Web Systems

Reusable building blocks shared by applications in [`active/web-apps/`](../../README.md).

## Shared Feedback System

The current shared package is the feedback system used by HTMX/Flask apps in this area.

- Backend module: `src/web_feedback/`
- Shared widget template: `templates/_shared_feedback.html`
- Helper entrypoint: `enable_shared_feedback(...)`

### Routes provided to apps

- `POST /feedback`
- `GET /feedback` (basic auth via `FEEDBACK_ADMIN_USERNAME` and `FEEDBACK_ADMIN_PASSWORD`)
- `POST /feedback/mark-addressed`

### Stored feedback fields

Saved feedback items include:

- `app` - server-defined application name
- `page_path` - client page path
- `page_title` - client page title

## Integration Notes

Apps using the shared system should:

1. wire in `enable_shared_feedback(...)`
2. provide admin credentials for feedback review
3. store runtime submissions in an app-local `data/feedback/` directory

Current example:

- [Parambulator](../../parambulator/README.md) uses this feedback system
- [Parambulator feedback data notes](../../parambulator/data/feedback/README.md) describe the runtime storage directory

## Deployment helpers

Shared deployment scripts now live in `scripts/` for the Flask web apps that publish immutable images to the thinker-local registry instead of downloading source at pod startup.

App wrappers:

- `../parambulator/scripts/`
- `../momos/scripts/`
- `../sub-day-generator/scripts/`

## Related Documentation

- [Web Apps index](../../README.md)
- [Repository root](../../../../README.md)

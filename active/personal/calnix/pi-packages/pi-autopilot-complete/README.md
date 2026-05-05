# pi-autopilot-complete

Pi extension that:

- adds a `complete` tool
- nudges the model to keep working until it calls `complete`
- supports `/autopilot on|off|toggle|status`
- persists autopilot state in the session
- automatically stays off while TDD mode is active

## Local test

```bash
pi -e ./pi-packages/pi-autopilot-complete
```

## Install from local path

```bash
pi install ./pi-packages/pi-autopilot-complete
```

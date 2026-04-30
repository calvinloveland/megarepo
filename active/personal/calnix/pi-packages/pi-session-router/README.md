# pi-session-router

Pi extension that automatically decides whether a new prompt belongs in another existing session.

## Behavior

- intercepts a newly submitted user prompt
- gathers recent project sessions
- asks an LLM to choose the most relevant existing session, if any
- switches to that session before continuing
- if no better session exists, keeps the current one

## Commands

```text
/session-router on
/session-router off
/session-router toggle
/session-router status
/session-router threshold 0.80
/session-router notices off
```

## Notes

- this is an opinionated workflow extension
- it uses a hidden internal command to perform session switching, because Pi only exposes session replacement APIs from command handlers
- it can stay in the current session, switch to another local session, or start a new session when no good match exists
- it keeps a lightweight cache at `~/.pi/agent/session-router-cache.json`

## Local test

```bash
pi -e ./pi-packages/pi-session-router
```

## Install from local path

```bash
pi install ./pi-packages/pi-session-router
```

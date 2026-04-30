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
- it uses an unsupported internal `AgentSession` hook to switch sessions invisibly during prompt interception
- it can stay in the current session, switch to another local session, or start a new session when no good match exists
- it keeps a lightweight cache at `~/.pi/agent/session-router-cache.json`
- routing heuristics now use exact informative-token overlap instead of loose substring matching, which avoids false `CURRENT` decisions on unrelated prompts

## Local test

```bash
pi -e ./pi-packages/pi-session-router
```

## Logic tests

```bash
cd pi-packages/pi-session-router
node --test tests/router-logic.test.mjs
```

## Install from local path

```bash
pi install ./pi-packages/pi-session-router
```

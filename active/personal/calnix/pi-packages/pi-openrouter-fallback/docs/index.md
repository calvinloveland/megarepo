# pi-openrouter-fallback

Pi extension that:

- scopes the OpenRouter model list to a curated subset so `/model` stays focused
- watches for HTTP 403 responses from OpenRouter
- switches to `openrouter/free`
- auto-resubmits the last prompt as a follow-up
- shows OpenRouter model pricing in the footer status area as input/output cost per 1M tokens

## Local test

```bash
pi -e ./pi-packages/pi-openrouter-fallback
```

## Install from local path

```bash
pi install ./pi-packages/pi-openrouter-fallback
```

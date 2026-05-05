# pi-subagents

Pi package for isolated scout/planner/reviewer/worker subagents.

## Attribution

This package is a **credited adaptation** of Pi's upstream subagent example from `examples/extensions/subagent/` in `@mariozechner/pi-coding-agent` by Mario Zechner and contributors.

See [NOTICE.md](NOTICE.md) for the exact attribution and what changed in this packaged version.

## What this package includes

- a `subagent` extension tool
- bundled default agents:
  - `scout`
  - `planner`
  - `reviewer`
  - `worker`
- bundled workflow prompts:
  - `/implement`
  - `/scout-and-plan`
  - `/implement-and-review`
  - `/ui-autopolish`
- logic tests for bundled/user/project agent discovery precedence

## Why package this instead of just copying the example

The upstream example is a strong starting point, but it expects manual symlinks for the default agent markdown files.

This package makes the pattern reusable by:

- bundling the default agents inside the package
- loading those bundled agents automatically
- still allowing user-level and project-level overrides
- keeping the original subprocess + JSON-mode architecture intact

## Behavior

- each subagent runs in a separate `pi` subprocess
- output is captured through JSON mode for structured updates
- supports:
  - single mode
  - parallel mode
  - chain mode
- bundled agents are always available
- user agents in `~/.pi/agent/agents` can override bundled agents with the same name
- project agents in `.pi/agents` can override bundled or user agents when `agentScope` is `project` or `both`
- interactive confirmation is still required before running project-local agents unless disabled explicitly

## Security model

Default behavior remains conservative:

- bundled agents are trusted as part of this package
- project-local agents are opt-in
- project-local agents should only be enabled for trusted repositories
- role-specific tool lists should stay narrow when possible

## Install from local path

```bash
pi install ./pi-packages/pi-subagents
```

## Try it immediately

```bash
pi -e ./pi-packages/pi-subagents
```

Then ask for things like:

```text
Use scout to find the authentication code.
Run two scouts in parallel: one for models and one for providers.
Use a chain: scout the read tool, then planner propose improvements.
/ui-autopolish tighten the dashboard header and reduce visual clutter
```

## Workflow prompts

Once installed, these prompts should be available through Pi's prompt discovery:

```text
/implement <query>
/scout-and-plan <query>
/implement-and-review <query>
/ui-autopolish <query>
```

## Custom agents

You can still define your own agents in:

- `~/.pi/agent/agents/*.md`
- `.pi/agents/*.md`

These override bundled defaults by name according to scope precedence.

## Local tests

```bash
cd pi-packages/pi-subagents
node --test tests/agents.test.mjs
```

## Extension smoke test

```bash
./pi-skills/pi-extension-testing/scripts/extension_test_plan.py ./pi-packages/pi-subagents --run
```

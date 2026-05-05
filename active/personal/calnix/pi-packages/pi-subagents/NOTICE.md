# Attribution Notice

This package is **adapted from** the Pi coding agent subagent example created by Mario Zechner and contributors.

Source materials used as the starting point:

- `examples/extensions/subagent/index.ts`
- `examples/extensions/subagent/agents.ts`
- `examples/extensions/subagent/agents/*.md`
- `examples/extensions/subagent/prompts/*.md`
- `examples/extensions/subagent/README.md`

Upstream source location at the time of adaptation:

- `@mariozechner/pi-coding-agent`

What changed in this packaged version:

- bundled the default agent markdown files inside the package
- changed agent discovery so bundled agents work without manual symlinks
- kept user-level and project-level agent override behavior
- added package metadata, prompts, tests, and package documentation
- added explicit attribution in code comments and docs

This package does **not** claim the original subagent concept or example implementation as original work by Calvin Loveland.
It is a credited adaptation packaged for reuse in this repository.

---
name: pi-subagent-patterns
description: Design and implement subagents in Pi by reusing the existing subagent extension example when it fits. Use when you want isolated worker/planner/reviewer agents, parallel delegation, or chained handoffs in Pi.
---

# Pi Subagent Patterns

Use this skill when you want subagents in Pi.

## Recommendation first

**Start by using an existing subagent extension** instead of inventing a brand-new architecture.

In this repository, the preferred reusable package is:

- `./pi-packages/pi-subagents`

That package is a properly attributed adaptation of Pi's upstream example.

If you want the raw upstream reference, the original starting point is Pi's built-in example at:

- `examples/extensions/subagent/`
- especially `examples/extensions/subagent/index.ts`
- plus `examples/extensions/subagent/agents.ts`
- and the sample agent markdown files under `examples/extensions/subagent/agents/`

This is the strongest current pattern because Pi core intentionally does **not** ship built-in subagents. The supported path is to build them with extensions or external orchestration.

## Best current architecture

The best general-purpose subagent system in Pi today is:

1. a custom **extension tool**
2. that **spawn separate `pi` subprocesses**
3. using **JSON mode** for structured event capture
4. with each subagent running in an **isolated context window**
5. and agent roles defined as markdown files with frontmatter

This is better than faking multiple agents inside a single conversation because each subprocess gets a clean context and separate execution lifecycle.

## Why this approach is best

This pattern gives you:

- isolated context per subagent
- reusable Pi behavior instead of reimplementing an agent loop yourself
- clean support for different models per role
- clean support for different tool sets per role
- easier abort handling
- safer separation between user-level and project-local agent prompts
- support for single, parallel, and chain workflows

## Reuse the existing extension package when it fits

Use `./pi-packages/pi-subagents` if you want:

- a `subagent` tool inside Pi
- single-agent delegation
- parallel subagent execution
- chain workflows using `{previous}` handoff text
- markdown-defined agent roles
- interactive confirmation before running project-local agents

The packaged adaptation already demonstrates:

- spawning separate `pi` processes
- collecting results from JSON mode
- rendering streaming updates
- tracking token/cost usage
- user-only vs project-local agent scope
- security confirmation for project-local agents
- reusable workflow prompts such as `/implement`, `/implement-and-review`, and `/ui-autopolish`

## Recommended roles

A good default role set is:

- `scout` for fast reconnaissance
- `planner` for implementation planning
- `reviewer` for critique and verification
- `worker` for implementation

Keep roles narrow when possible. A planner should usually be read-only. A reviewer should usually not need write access.

## Recommended execution modes

Support these three modes first:

### Single
One agent handles one delegated task.

### Parallel
Several agents work at once on independent questions.

### Chain
Agents run sequentially and pass compact handoff text to the next step.

These three modes cover most useful subagent workflows without overcomplicating the system.

A good concrete example in this repo is a bounded UI polish flow such as `/ui-autopolish`, where a `worker` and `reviewer` alternate around screenshot-regression artifacts rather than running an unbounded autonomous loop.

## Security guidance

Prefer this trust model:

- default to **user-level agents** only
- treat **project-local agents** as opt-in
- confirm before running repo-controlled project-local agents
- keep tool access narrow per role

Project-local agents are powerful because they are effectively repo-supplied executable prompting.

## When to use something else

Use the SDK instead of subprocesses if you are building a custom Node app and want in-process control with `createAgentSession()`.

Use multiple interactive Pi sessions in `tmux` if the "subagents" are really long-lived human-driven workers, not short delegated tool calls.

## Implementation checklist

When adapting the example into your own package or extension:

1. start from `examples/extensions/subagent/`
2. keep the extension entrypoint focused on orchestration
3. move discovery/config helpers into separate importable modules
4. define roles in markdown with frontmatter for `name`, `description`, optional `model`, and optional `tools`
5. constrain tools by role
6. add timeouts and concurrency limits
7. define a compact output contract for agent handoffs
8. test the helper modules before relying on manual Pi smoke tests

## Good output contract for subagents

Ask each subagent to finish with structured sections like:

- Completed
- Files Changed
- Risks
- Notes
- Next Steps

That makes chain handoffs and human review much easier.

## What to avoid

Avoid these patterns unless you have a strong reason:

- pretending subagents are isolated when they all share one context
- giving every role full tools by default
- scraping terminal text instead of using JSON mode
- building a complex DAG scheduler before single/parallel/chain are working well

## Practical conclusion

If the user wants the best way to do subagents in Pi, recommend:

- **use the existing subagent example extension first**
- adapt it into a package or local extension only as needed
- keep subprocess isolation and JSON mode
- keep project-local agent prompts opt-in

That is the most Pi-native and maintainable design currently available.

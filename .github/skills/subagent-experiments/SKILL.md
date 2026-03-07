//---
name: Subagent experiment coordination
description: Run multiple bounded subagents in parallel, capture reliable experiment reports, and turn them into actionable implementation decisions.
version: 0.1.0
owners: - team: engineering
tags: - subagents - experiments - research - workflow
inputs:
- Project root
- Benchmark command or evaluation harness
- Candidate experiment ideas
---

# Subagent experiment coordination

## Intent

Use multiple subagents to test independent ideas in parallel, then consolidate the results into a ranked implementation plan.

## When to use

- You have several plausible improvement ideas and need evidence before coding.
- Each idea can be tested independently on the same benchmark or corpus.
- The work is exploratory enough that temporary scripts and `/tmp` artifacts are preferable to immediate repo edits.

## Workflow

1. Define the experiment slice first
   - Pick a bounded corpus, benchmark command, or representative hard cases.
   - Prefer one shared slice for comparability across agents.

2. Give each subagent one idea only
   - Keep prompts narrowly scoped.
   - Ask the agent to test the idea itself, not just brainstorm.
   - Require temp-only artifacts unless the goal is an implementation.

3. Ask for concrete deliverables
   - Exact commands used.
   - Metrics before and after.
   - A recommendation: pursue, defer, or drop.
   - Explicit caveats about benchmark quality and oracle leakage.

4. Run agents in parallel
   - Good fits: preprocessing recipes, ensemble methods, post-OCR cleanup, layout segmentation, reranking ideas.
   - Keep a SQL todo for each experiment so progress stays visible.

5. Trust agent reports more than shell notifications
   - Background shell notifications may complete without useful stdout.
   - Ask subagents to produce a synthesized final report instead of relying on ad hoc shell output.

6. Record negative results
   - A failed idea is still useful if it eliminates a class of approaches.
   - Update plan/status docs so the same dead end is not re-tested casually.

7. Turn results into the next implementation step
   - Promote only the strongest evidence-backed ideas into product code.
   - Prefer the smallest productionizable version first.

## Prompting guidelines

- Include the exact project path and relevant files.
- State whether repo edits are allowed. If not, require `/tmp` scripts and outputs.
- Supply the current best known baseline so the agent can compare honestly.
- Ask for a bounded experiment, not an open-ended research project.
- Request failure modes and reasons not to pursue the idea.

## Lessons learned

- Background subagents are excellent for comparing several OCR ideas at once when each can run against the same synthetic corpus slice.
- Reconciliation/ensemble prompts need truly ambiguous candidate sets; if one candidate already dominates, consensus experiments mostly waste time.
- Generic shell notifications are weak evidence. The useful artifact is the agent's written synthesis with numbers and caveats.
- Inverse-render or other expensive verification ideas are practical when the user values accuracy over runtime.
- Negative findings should be written down immediately so future work stays focused on the remaining high-value paths.

## Failure modes

- If agents share too much scope, their reports overlap and waste time.
- If the benchmark slice differs between agents, result comparisons become noisy.
- If prompts do not forbid permanent edits, exploratory agents may leave messy repo changes.
- If you ask for “ideas” instead of “experiments,” you will get speculation instead of evidence.

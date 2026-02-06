---
name: Address feedback
description: Systematically review feedback items, apply fixes, validate, and mark items as addressed to keep the queue clean.
version: 0.1.0
owners:
	- team: engineering
tags:
	- feedback
	- triage
	- maintenance
inputs:
	- name: feedback_dir
		description: Path containing feedback JSON files.
		required: true
		default: data/feedback
	- name: addressed_dir
		description: Subdirectory for addressed feedback.
		required: true
		default: data/feedback/addressed
	- name: include_patterns
		description: Optional glob patterns for selecting feedback files.
		required: false
	- name: exclude_patterns
		description: Optional glob patterns to exclude.
		required: false
outputs:
	- name: summary
		description: Brief summary of addressed feedback and changes.
	- name: addressed_ids
		description: List of feedback IDs or filenames marked as addressed.
---

# Address feedback

## Intent

Continuously reduce feedback backlog by processing items one by one, implementing fixes, validating changes, and marking addressed feedback so it does not appear again.

## When to use

- New feedback files exist in the feedback directory.
- You need a repeatable workflow to keep the feedback queue clean.
- A user requests that feedback be addressed “one by one.”

## Preconditions

- Feedback files exist as JSON under the configured directory.
- A mechanism to mark feedback addressed is available (endpoint, CLI, or file move).

## Workflow

1. Discover feedback files
	 - List JSON files in the feedback directory.
	 - Exclude the addressed directory and any ignored patterns.

2. Read and categorize
	 - Parse each feedback item.
	 - Classify as actionable, duplicate/test, or already addressed.

3. Address actionable items one by one
	 - Reproduce the reported behavior if possible.
	 - Identify relevant files and functions.
	 - Implement a minimal, targeted fix.
	 - Add or update tests when appropriate.

4. Validate
	 - Run relevant tests or checks.
	 - Confirm the issue no longer occurs.

5. Mark addressed
	 - Set `addressed: true` and add an `addressed_timestamp`.
	 - Move the file into the addressed directory (or call an API if provided).

6. Summarize
	 - Provide a concise summary of changes.
	 - List addressed feedback IDs.

## Guidelines

- Keep fixes small and focused.
- Avoid unrelated refactors.
- Prefer adding tests for regressions.
- Preserve existing UX patterns.
- Do not delete feedback; archive it as addressed.

## Example output

- Addressed feedback_20260206_195120_939786.json by removing tab navigation flicker.
- Addressed feedback_20260206_195740_928404.json by preventing click-through during element selection.

## Failure modes

- If feedback is unclear, note what additional details are needed.
- If unable to reproduce, document assumptions and provide a best-effort fix.
- If fix requires product decisions, mark as blocked and do not mark addressed.

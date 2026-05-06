# Agent Hiring Framework

A planning note for a multi-agent system where an expensive, high-judgment **CEO agent** hires cheaper specialist agents under a fixed budget.

## Core Idea

Given:
- a user goal
- a budget
- a pool of available models/tools

The CEO agent breaks the work into jobs, asks possible hires to produce a short **resume** for each job, compares expected value against expected token/tool cost, and hires the best mix of agents for the available budget.

The key promise is:

> Use expensive intelligence for high-leverage coordination, and cheaper intelligence for narrow execution.

## Why This Is Interesting

Most agent systems already do some version of routing, but your idea adds two useful twists:

1. **Budget is explicit**, not hidden.
2. **Candidate selection is contextual**, because models pitch themselves for a specific role instead of being statically assigned.

That makes this feel closer to:
- hiring
- contracting
- procurement
- portfolio allocation

than a normal supervisor-worker tree.

## Sharp Version of the Thesis

A good version of this framework is not:
- “many agents because many agents sound cool”

It is:
- “pay for expensive reasoning only where it changes outcomes”
- “let lower-cost models compete for bounded tasks”
- “track whether quoted capabilities and quoted cost matched reality”

If you keep that framing, the system stays practical instead of theatrical.

## Suggested Mental Model

Think of the framework as five loops:

1. **Plan loop** — CEO understands the goal and decomposes it.
2. **Hiring loop** — candidate agents bid for jobs.
3. **Execution loop** — hires perform work.
4. **Review loop** — CEO or reviewer agents judge outputs.
5. **Learning loop** — the system updates beliefs about which models are worth hiring for which jobs.

## Main Entities

### 1. Goal
The user request plus constraints.

Example:
- Build a landing page
- Budget: $1.20
- Deadline: one run only
- Must pass tests
- Prefer speed over polish

### 2. Budget
Track multiple budgets, not just tokens.

Recommended dimensions:
- prompt tokens
- completion tokens
- tool/runtime cost
- wall-clock latency
- max parallelism
- human attention budget

A model can be cheap in token terms but expensive in latency or review burden.

### 3. Job
A bounded unit of work or a specific role

Each job should have:
- objective
- inputs
- expected output format
- acceptance criteria
- max budget
- risk level
- whether tools are allowed
- whether delegation is allowed

Examples:
- research 3 architecture options
- tester - creaye failing tests for user reports and pass to the engineering team
- implement patch in one file
- critique UI for accessibility
- risk management

### 4. Candidate
A possible hire for a job.

A candidate can be:
- a model + prompt template
- a model + tools bundle
- a model + role definition

This is important: the thing being hired should usually be a **configured worker profile**, not just a raw model name.

### 5. Resume
A structured self-description for one specific job.

A resume should not be pure free text. Make it partially structured.

Suggested fields:
- candidate id
- model name
- role name
- relevant strengths
- likely weaknesses
- estimated token usage
- estimated latency
- confidence score
- evidence source
- sample plan
- ask price / max cost
- preferred review level

### 6. Hire
The CEO chooses a candidate and creates a contract:
- scope
- budget cap
- deliverable format
- deadline / timeout
- escalation rules
- review process

### 7. Outcome Record
Every hire should produce a record:
- predicted cost vs actual cost
- predicted confidence vs actual quality
- acceptance / rejection
- defects found later
- review overhead required

This becomes the basis for better future hiring.

## Important Design Choice: Resume

The biggest risk in the idea is that resumes become pure bluffing.

If agents freely write persuasive resumes, your framework may reward the best salesperson rather than the best worker.

A failed hire is an issue in the hiring/employee review process

## Selection Algorithm

Let the CEO deciide how to handle this

## Budgeting Model

You will want both **quoted budget** and **hard budget**.

### Quoted budget
What the candidate says it expects to use.

### Hard budget
The actual cap enforced by the runtime.

For each job track:
- estimate prompt tokens
- estimate completion tokens
- review reserve
- retry reserve
- escalation reserve

### Recommended budgeting rule
Keep some budget unallocated.

Example:
- 60% execution budget
- 20% CEO planning and review
- 10% retries
- 10% contingency

Without a reserved contingency, the framework will spend everything early and have no budget left for recovery.

## Recommended Architecture

## Layer 1: Registry
A registry of available worker profiles.

Stores:
- model/provider
- pricing
- max context
- tool permissions
- benchmark history
- prior outcomes by task type

## Layer 2: CEO
Responsible for:
- understanding the goal
- decomposing into jobs
- assigning budgets
- deciding when not to delegate
- deciding whether to run jobs sequentially or in parallel

## Layer 3: Hiring Market
Given a job, it:
- selects eligible candidates
- generates resumes or bids
- ranks them
- returns top options to the CEO

## Layer 4: Worker Runtime
Runs the selected worker under a contract:
- system prompt
- budget cap
- tool policy
- timeout
- output schema

## Layer 5: Review Runtime
Checks whether work is acceptable.

Review can be done by:
- the CEO
- a dedicated reviewer model
- deterministic tests / linters / validators
- hybrid review

## Layer 6: Memory / Analytics
Stores:
- cost estimates
- actual performance
- job taxonomy
- worker reliability
- common failure patterns

That transparency is part of the product value.

## Example Run

### Input
- Goal: “Fix failing parser tests and explain the bug.”
- Budget: $0.80

### CEO decomposition
1. Reproduce failure
2. Inspect parser logic
3. Propose fix
4. Implement patch
5. Explain root cause

### Hiring
- Researcher bids cheaply on steps 1-3
- Implementer bids on step 4
- Reviewer bids on step 5 or validates patch

### CEO decision
- Hire cheap researcher for reproduction and diagnosis
- Hire mid-cost implementer for code change
- Reserve CEO budget for final synthesis and escalation

### Outcome
If the researcher fails, CEO can either:
- retry with a different worker
- collapse the plan and do the rest itself
- stop early and report budget exhaustion

## Key Product Questions

### 1. Who writes the resumes?
- each candidate model writes its own


### 2. Can workers hire sub-workers?
If the CEO wants

### 3. What happens when a worker exceeds budget?
Define this up front.

Options:
- hard stop
- partial output accepted
- worker must return escalation request
- CEO reassigns remaining work

A clean rule is:
- workers must emit either `deliverable`, `blocked`, or `escalation_request` before budget exhaustion.

### 4. Who verifies resume accuracy?
CEO

## Biggest Risks

### 1. Resume theater
Workers learn to sound competent instead of being competent.

Mitigation:
- structured resumes
- historical performance weighting
- cheap deterministic review

### 2. Budget death by management overhead
The CEO spends too much budget planning, comparing, and reviewing.

Mitigation:
- cap planning depth
- shortlist only a few candidates
- do not request resumes from every possible model

### 3. Fragmentation overhead
Splitting work into too many jobs costs more than doing it directly.

Mitigation:
- penalize excessive decomposition
- estimate coordination cost explicitly
- only split when the jobs are meaningfully separable

### 4. Reward hacking
Workers optimize for passing the reviewer rather than solving the task.

Mitigation:
- hybrid evaluation
- spot checks by CEO
- delayed outcome tracking where possible

### 5. Talent monoculture
The CEO always picks the same worker and never explores better options.

Mitigation:
- small exploration budget
- epsilon-greedy or Thompson sampling style hiring exploration

## What Makes This Better Than Simple Routing

To justify the framework, it should eventually do at least one of these better than fixed routing:

- adapt to changing budgets
- adapt to changing worker prices
- adapt to changing task types
- learn which workers are reliable in your actual environment
- expose an auditable decision trail to users

If it cannot do those things, a static router may be simpler and better.

## Practical Implementation Idea

Represent each worker as a configuration object.

Example fields:

```json
{
  "worker_id": "implementer-mid-1",
  "model": "provider/model-name",
  "role": "implementer",
  "input_price_per_million": 0.15,
  "output_price_per_million": 0.60,
  "tools": ["read", "edit", "bash"],
  "allowed_job_types": ["coding", "refactor", "bugfix"],
  "historical_acceptance_rate": 0.71,
  "historical_cost_error": 0.18,
  "historical_review_burden": 0.22
}
```

Then a job application can be a structured object like:

```json
{
  "job_id": "job-4",
  "worker_id": "implementer-mid-1",
  "predicted_success": 0.74,
  "predicted_input_tokens": 1800,
  "predicted_output_tokens": 900,
  "predicted_latency_seconds": 35,
  "confidence": 0.68,
  "risks": ["may need extra context from tests"],
  "plan_summary": "Inspect failing parser branch, patch state transition, run tests"
}
```

This is much easier to rank and analyze than raw prose.

## Research Directions After MVP

### Market mechanisms
- first-price bids
- sealed bids
- score-based selection
- portfolio hiring where multiple workers attempt the same task

### Learning mechanisms
- contextual bandits
- Bayesian reliability estimation
- calibration scoring for confidence claims

### Organization design
- CEO + recruiter + reviewer
- CEO + department heads + workers
- dual-CEO debate for high-risk jobs
- specialist bench with dynamic promotion/demotion

### Memory
- per-task-type leaderboards
- cost-quality frontier tracking
- failure-case retrieval when hiring for similar jobs

## Roadmap

### Phase 1 — Paper prototype
- define job schema
- define worker schema
- define resume schema
- define cost ledger
- define evaluation rubric

### Phase 2 — Narrow coded prototype
- fixed worker pool
- coding or research domain only
- single CEO
- single reviewer
- JSON-only applications and outcomes

### Phase 3 — Learning prototype
- track worker history
- weight hiring by observed performance
- introduce light exploration

### Phase 4 — Recursive organization
- allow department heads or sub-managers
- add delegation limits and budget inheritance
- compare against flat hiring

## Concrete Recommendations

If you want this idea to survive contact with reality, I would recommend:


5. **Treat planning overhead as a cost center.**
   - the CEO should have its own budget line

6. **Log everything.**
   - estimated cost
   - actual cost
   - estimated confidence
   - actual success


## Open Questions Worth Answering Next

1. Is the main optimization target **quality under fixed budget** or **lowest cost for acceptable quality**?
A: Those seem the same
2. Should the CEO see all model identities and prices, or should it choose from abstract worker profiles?
A: identities no, prices yes
3. Should applications be generated by the candidate, by a recruiter, or from historical metadata only?
A: candidate
4. How much budget can the CEO spend on hiring before it should just do the work?
A: up to CEO
5. When should the CEO parallelize competing workers on the same task?
A: up to CEO
6. How will you prevent infinite delegation or budget fragmentation?
A: up to CEO

## Short Pitch Version

Here is a crisp way to describe the framework:

> An agent orchestration framework where a high-judgment manager model allocates a fixed budget across specialist model workers. Workers apply for bounded jobs with structured cost and capability claims, the manager hires them under hard caps, and the system learns over time which workers are actually worth the money.

## My Suggested Next Step

Write a v0 spec with exactly four things:
- worker profile schema
- job schema
- application schema
- run ledger schema

If you want, the next thing I can do is turn this into:
1. a concrete architecture spec,
2. an MVP PRD,
3. JSON schemas for the framework objects, or
4. a worked example of a full run from goal to hiring to review.

# Warden Hierarchy Design

## Purpose

This document refines the relationship between **Warden** and **homogenized compute**.

The key architectural decision is:

- A **Warden** should primarily **support, defend, and report on a single machine**.
- The broader homogenized-compute system should emerge from a **hierarchy of Wardens**, not by turning every per-host Warden into a full distributed OS on its own.

That means Warden remains a host-focused agent, while a higher-level Warden role aggregates multiple hosts into a coherent pool.

## Review of the Plan So Far

## What still feels right

### 1. The dashboard should show the fleet as a pool

The global dashboard view is still useful.

Even if each Warden is host-first, it is valuable to see:

- total CPU across all known machines
- total RAM across the fleet
- total disk capacity across all machines
- which hosts are online, degraded, or unavailable

That view does **not** require every Warden to become a cluster scheduler. It simply means at least one Warden instance can aggregate information from others.

### 2. Per-host resource reporting belongs in Warden

It still makes sense for each Warden to know and expose:

- local CPU capacity and current load
- local memory capacity and current pressure
- local storage availability and pressure
- thermals
- battery / power state
- network reachability
- backup status
- generation / config drift

These are all local defense and readiness questions.

### 3. Peer communication belongs in Warden

If Wardens are the trusted local stewards of each host, they should be the natural interface for:

- reporting health upward
- answering resource queries
- accepting or declining work proposals
- sharing local policy and readiness state

## What needs correction

### 1. Warden should not absorb the entire homogenized-compute problem

The following do **not** naturally belong inside every per-host Warden:

- transparent unified filesystem semantics
- broad process migration logic
- global scheduling for all workloads
- user-facing distributed runtime semantics
- application-specific orchestration policies

Those are fleet-level concerns.

### 2. Flat peer meshes are not the whole answer

A pure all-to-all peer model is fine for health visibility, but not ideal for coordination.

For homogenized compute, it is more natural to have one or more Wardens act as:

- **parent aggregators**
- **policy coordinators**
- **global dashboard hosts**
- eventually, **dispatchers / schedulers**

### 3. The global dashboard should conceptually live on a parent role

The current pooled dashboard is a good design direction, but architecturally it makes the most sense as a **parent-Warden view**.

A leaf Warden may still expose a local dashboard, but the fleet-wide pool belongs to a parent or coordinator role.

## Recommended Model

Use a **hierarchy of Wardens**.

### Roles

#### Leaf Warden

Runs on an individual host and focuses on that host.

Responsibilities:

- run local health checks
- perform local remediation
- manage local backups
- report local resources and readiness
- maintain local event history
- expose an API for parents / peers
- defend local boundaries and refuse unsafe work

A leaf Warden should be able to operate completely usefully even if no parent exists.

#### Parent Warden

Runs on a stable node and aggregates multiple leaves.

Responsibilities:

- maintain fleet membership view
- aggregate host health into a global dashboard
- aggregate total resources across the fleet
- hold higher-level policy
- arbitrate which leaf is best suited for work
- maintain topology and availability state
- eventually dispatch work to leaves

The parent is not necessarily a separate codebase. It can be a **mode** of Warden.

#### Both-role Warden

A single Warden instance can be both a leaf for its own host and a parent for other hosts.

This is likely the practical default for a desktop or NAS:

- defend itself locally
- also act as the fleet coordinator

## Mental Model

```text
phone Warden   laptop Warden   desktop Warden   nas Warden
    │               │               │               │
    └────── reports upward / answers queries ───────┘
                            │
                    parent Warden view
                            │
             pooled dashboard + policy + dispatch
```

In a minimal deployment, the desktop Warden may play both roles.

## Boundaries: What Belongs Where

## Leaf Warden scope

Leaf Warden should own:

- local checks
- local remediations
- local backup execution
- local telemetry collection
- local readiness / admission control
- local trust policy
- local storage export capability
- local compute export capability metadata

Examples:

- "This machine has 32 GB RAM, 12 CPU threads, battery 84%, on AC power."
- "This machine is too hot to accept GPU work right now."
- "This disk is under pressure and should not receive more cold-data replicas."

## Parent Warden scope

Parent Warden should own:

- fleet inventory
- global dashboard
- aggregate resource summaries
- fleet-wide policy
- work placement recommendations
- topology awareness
- graceful failover when leaves disappear
- routing work to suitable leaves

Examples:

- "The laptop has the best available GPU for this workload."
- "The NAS should receive cold-storage replicas because the laptop is nearly full."
- "Do not offload any work to battery-powered devices below 25%."

## Outside Warden entirely

Some things probably belong in a layer above or beside Warden even if Warden supplies the telemetry:

- unified filesystem implementation
- transparent process migration runtime
- application SDK / runtime integration
- stream transport for remote rendering
- object/block replication engine

Warden should make those possible, not necessarily implement all of them.

## Design Principles

### 1. Host sovereignty first

Each leaf Warden should be able to say:

- yes
- no
- not now
- only under these constraints

No parent should force unsafe work onto a host that is too hot, too low on battery, too full, or otherwise constrained.

### 2. Parent view is advisory before it is authoritative

Early on, the parent should probably make **recommendations** rather than hard orchestration decisions.

That lets the design mature without immediately committing to a full distributed runtime.

### 3. Aggregation first, dispatch second, migration last

A good phased order is:

1. aggregate
2. evaluate
3. recommend
4. dispatch
5. migrate / replicate / rebalance automatically

### 4. Local trust boundaries remain real

Even in a personal fleet, a phone, laptop, NAS, and desktop may not be equally trusted.

The system should support:

- trust tiers
- capability grants
- per-role policy
- workload classes

### 5. Every feature should degrade gracefully when the parent is gone

If the parent host disappears:

- leaf Wardens still work
- local checks still run
- local backups still run
- local dashboards still work
- resource exports continue
- another parent can later resume aggregation

## Current State vs. Missing Pieces

## What already exists or is close

The current Warden implementation already supports much of the **leaf** story:

- local checks
- local remediation
- local backups
- local events
- peer API
- dashboard
- aggregated resource summary on the dashboard
- CPU / memory / disk reporting

That means the project already has a strong substrate for the hierarchy.

## What is still missing for the hierarchy

### Parent-role mechanics

- explicit `role = leaf | parent | both`
- parent discovery or configuration
- leaf registration with a parent
- fleet membership state separate from simple peer cache

### Readiness / admission control

Leafs need a clear answer to:

- can I take work?
- what kinds of work can I take?
- for how long?
- under what constraints?

### Policy model

Need a structured way to express policies like:

- no remote workloads when on battery
- reserve at least 25% disk headroom
- allow AI inference but not long-running game rendering
- only parent X may dispatch to this host

### Topology model

Need fleet-aware data such as:

- latency between nodes
- bandwidth estimates
- battery / AC status
- reliability class of each node
- trust class of each node

### Dispatch protocol

Eventually the parent needs a protocol for:

- proposing a workload
- reserving resources on a leaf
- receiving accept / reject / defer responses
- tracking a running assignment
- cancelling or reassigning work

## Hardest Pain Points

These are the places most likely to be genuinely difficult, slow, or architecture-shaping.

### 1. Preserving host sovereignty without making the system toothless

This is probably the deepest design tension.

You want each leaf Warden to remain the defender of its host. That means a parent cannot simply treat leaves as dumb workers. But if every leaf has too much discretion, the fleet never feels like one coherent machine.

The hard part is designing an interaction model where:

- the parent can make useful global decisions
- the leaf can still refuse work safely
- the user is not constantly surprised by silent refusal or hidden constraints

This is a product problem as much as a systems problem.

### 2. Defining a readiness model that is simple enough to implement but rich enough to matter

A leaf needs to answer questions like:

- Can I take work right now?
- What class of work can I take?
- For how long?
- Under what power / thermal / storage constraints?

If the readiness schema is too simple, parent decisions will be bad.
If it is too detailed, the system becomes unbuildable and hard to reason about.

Finding the minimum useful readiness vocabulary is likely one of the hardest early design tasks.

### 3. Policy design

Policy is where otherwise elegant systems become messy.

You likely need to express things like:

- do not use battery-powered devices below 25%
- never place sensitive workloads on the phone
- use the NAS for cold storage, not for latency-sensitive work
- reserve some resources for local interactive use

The hard part is avoiding a policy model that becomes:

- too implicit
- too magical
- too difficult to debug
- too complicated for humans to understand

### 4. Fleet topology and network reality

A homogenized system feels easy in the abstract until you factor in:

- WiFi roaming
- laptop sleep
- LTE links
- Tailscale instability
- bandwidth asymmetry
- packet loss
- changing latency over time

A parent cannot make good decisions without a realistic picture of network quality, but building and maintaining that picture is non-trivial.

This is especially painful because network conditions are dynamic, not static.

### 5. Trust tiers and security boundaries

Even in a personal fleet, trust is not flat.

Examples:

- the phone may be more exposed to hostile networks
- the NAS may be more trusted for storage than for arbitrary execution
- the desktop may be trusted for GPU work but not for holding the only copy of critical data

The hard problem is expressing:

- who may dispatch to whom
- what kind of workload may run where
- what data may be exposed to which host
- how to audit those decisions later

Security mistakes here would turn a cool architecture into a dangerous one.

### 6. Distinguishing Warden responsibilities from higher-level runtime responsibilities

This is more important than it sounds.

If too much logic goes into Warden, the per-host defender becomes bloated and brittle.
If too much is pushed upward, the parent or runtime loses the grounded host knowledge that makes it safe.

The hardest part may not be writing code, but maintaining a clean boundary over time.

This is the kind of architectural drift that often kills good systems.

### 7. Failure handling when the parent disappears

The fleet should still function when the parent host goes away.

But several things become tricky:

- who owns fleet state?
- where does policy live?
- who becomes parent next?
- what happens to running assignments?
- how do leaves avoid split-brain views of the fleet?

Designing this well without over-engineering leader election on day one will be hard.

### 8. Dispatch before migration

The temptation will be to jump toward full remote execution and process migration.

But the real difficulty is getting the earlier step right:

- clear job proposal
- clear admission response
- clear reservation semantics
- clear cancellation / timeout behavior
- clear audit trail

If dispatch semantics are sloppy, deeper homogenized compute features will rest on a weak foundation.

### 9. UX clarity

The system is aiming for magic, but it cannot feel mysterious.

The user needs to understand things like:

- why a host was chosen
- why a host refused work
- why storage moved
- why the fleet looks degraded even though one device seems fine
- what is local versus remote at any given moment

A system like this can fail by being conceptually brilliant but operationally opaque.

### 10. Choosing the first vertical slice

This is likely the hardest project-management decision.

Possible first slices include:

- parent dashboard + readiness only
- storage placement recommendations
- distributed builds
- GPU render dispatch
- AI inference placement

Choosing the wrong first slice could force the architecture toward the wrong constraints too early.
Choosing the right slice could clarify nearly every other design decision.

## Recommended Phased Roadmap

### Phase 0 — clarify architecture

Document the hierarchy and keep Warden host-first.

Deliverables:

- roles model
- scope boundaries
- policy concepts
- admission-control concepts

### Phase 1 — parent dashboard and fleet inventory

Build the hierarchy without workload execution yet.

Deliverables:

- parent mode
- fleet membership view
- aggregated dashboard on parent
- local-only dashboard on leaves
- role-aware API responses

Success condition:

A designated parent can tell you what the fleet looks like without pretending that workloads are already migratable.

### Phase 2 — readiness and policy

Deliverables:

- leaf readiness endpoint
- battery / AC / thermal / headroom reporting
- per-host policy config
- parent policy evaluation

Success condition:

The parent can tell you **where** a workload should go and **why**, even if it does not yet launch it.

### Phase 3 — recommendation engine

Deliverables:

- workload classification
- candidate ranking
- recommendation API
- dashboard explanations like:
  - "best node for GPU render"
  - "best node for cold storage"
  - "best node for AI inference"

Success condition:

The system becomes a useful decision engine before it becomes a full automation engine.

### Phase 4 — dispatch

Deliverables:

- job proposal / acceptance protocol
- resource reservations
- basic remote execution wrappers
- audit trail for assignments

Success condition:

The parent can safely ask a leaf to run a bounded class of work.

### Phase 5 — deeper homogenized compute

Likely outside core Warden, but enabled by it.

Deliverables might include:

- unified storage layer
- remote rendering layer
- distributed build execution
- data migration / replication engine
- application-aware runtime integration

## Immediate Next Design Questions

1. Should parent mode live inside the existing Warden binary / service, or become a companion service?
2. Should leaves push status upward, or should parents poll them?
3. Should the global dashboard be parent-only, or can any host render a fleet snapshot by querying the parent?
4. What is the minimum readiness schema a leaf should expose?
5. What is the first workload class to support: storage placement, build execution, GPU rendering, or AI inference?
6. How should trust tiers be represented: explicit labels, capabilities, or policy rules?

## Recommendation

The cleanest path right now is:

- keep the current per-host Warden strong
- formalize **leaf / parent / both** roles
- treat the current pooled dashboard as the beginning of **parent mode**
- delay full workload migration until readiness, policy, and dispatch semantics are explicit

That preserves the strongest insight in the current plan:

> each machine has a defender, and the fleet can still be seen as one pool.

## Status

**Design in progress. Phase 1 implementation complete.**

What's been built:

- role config (leaf / parent / both) in Nix module, state, and env vars
- parent config for leaves
- fleet state management (register_leaf, deregister_leaf, load_fleet_state)
- wardend endpoints: /warden/register, /warden/heartbeat, /warden/fleet, /warden/role
- role-aware dashboard (pooled hero for parent, leaf-hero for leaf, role badge)
- wardenctl commands: role (show/set), fleet (list/show), register

What's next (Phase 2 readiness + policy):

- leaf readiness schema (battery, thermal, headroom, workload classes)
- per-host policy config
- parent policy evaluation

This is a refinement of the homogenized-compute idea and a review of the current Warden direction, not yet a fully deployed system.

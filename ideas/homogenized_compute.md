# Homogenized Compute

## Concept

All the computers you own — phone, laptop, desktop, NAS, home server — become a single logical machine. The device in your hands is just the current **portal** into the system. The physical topology of resources is mostly hidden from the user.

Instead of:

- Phone
- Laptop
- Desktop
- NAS
- Home server

being separate devices, they become:

- **One distributed computer**
- Multiple screens, keyboards, cameras, batteries, and radios attached to it

Applications don't care where resources physically live. The scheduler, filesystem, and runtime collaborate to place computation and data optimally across the available hardware.

## Visionary Examples

### Storage

Laptop SSD fills up. Instead of "Disk Full," the filesystem automatically migrates cold files to the desktop's larger SSD. To the user, storage capacity just increased. No network shares. No copying files.

### Gaming

Phone launches a graphically intensive game. The scheduler notices the phone's GPU is insufficient but the laptop in the backpack is available. The game process runs on the laptop GPU, video streams to the phone, and controls travel back. From the user's perspective, the phone is running the game.

### AI / ML

Phone asks an AI model a question. The system notices the desktop has 128 GB RAM and the NAS has an AI accelerator. The model executes there. The response appears on the phone.

### Compilation

You hit build on your laptop. The scheduler spreads compilation across the desktop CPU, NAS CPU, and laptop CPU. Build completes faster. No explicit cluster setup.

### Resource Map Example

| Resource | Physically Located On | Appears As |
|---|---|---|
| 8 TB SSD | Desktop | Global storage pool |
| RTX 8090 | Desktop | Global graphics accelerator |
| Large battery | Laptop | Global power resource |
| Cellular modem | Phone | Global network access |
| Webcam | Laptop | Global camera resource |

## Core Questions the System Must Answer

- Which machine should execute a given process?
- How expensive is it to move data from one node to another?
- What happens when the laptop goes offline?
- What if the phone is on LTE vs. WiFi?
- Which copy of a file is authoritative?
- How much battery should remote execution consume on the donating machine?
- How do we handle latency between nodes with different network quality?

## Key Technical Challenges

### Resource Coherence

The system must maintain a consistent view of available resources across all nodes. This includes CPU capacity, GPU availability, memory pressure, storage utilization, battery state, and network quality.

### Data Locality and Migration

Deciding where data should live and when to move it. The system needs to balance:

- Access latency
- Storage capacity
- Power consumption
- Network bandwidth costs
- Data durability / replication factor

### Execution Placement

A scheduler must decide where to run a process based on:

- Hardware requirements (GPU, RAM, accelerator)
- Input data location
- Latency sensitivity
- Power source and battery budget
- Trust and security boundaries

### Network Topology Awareness

The scheduler must treat connections differently:

- Localhost (same machine) — near-zero latency
- LAN (same network) — low latency, high bandwidth
- Tailscale / mesh — medium latency, variable bandwidth
- LTE / cellular — higher latency, metered bandwidth
- Offline — must handle gracefully

### Offline and Partially Connected Operation

Nodes go offline (lid closed, airplane mode, dead battery). The system must:

- Gracefully handle disappearance of resources
- Migrate processes from disappearing nodes
- Replicate or protect data against unexpected disconnection
- Re-integrate nodes when they return

### Security and Trust

- Can any device execute code from any other device?
- What isolation mechanisms exist between workloads?
- How does a compromised device affect the rest of the system?
- Do you trust your desktop GPU to render your phone's banking session?

### Versioning and Conflict Resolution

When multiple nodes can write the same data, conflicts arise. The system needs:

- A consistent conflict resolution strategy (CRDTs, LWW, vector clocks)
- Clear ownership semantics per file or data object
- Offline write support with sync on reconnection

## Related Prior Art

The idea is not new. Researchers have been chasing it for decades:

### Operating Systems

- **Plan 9** — Bell Labs distributed OS. Everything is a file. Namespaces are per-process. Machines are interchangeable.
- **Amoeba** — Vrije Universiteit Amsterdam. Object-based distributed OS with transparent remote execution.
- **Sprite** — Berkeley. Network-transparent filesystem and process migration.
- **Inferno** — Bell Labs descendant of Plan 9. Virtual OS for networked environments.
- **HelenOS** — Modern research OS. Support for multiserver microkernel, early distributed capabilities.

### Modern Partial Solutions

- **Kubernetes** — Hides individual machines behind a cluster abstraction, but designed for datacenter workloads, not personal devices.
- **Apple Continuity / Universal Control** — Shares clipboard, keyboard, mouse, and screen across Apple devices, but does not transparently migrate compute.
- **Steam Remote Play / Moonlight** — Streams GPU-rendered content across devices, but only for games and requires explicit per-app configuration.
- **Tailscale / ZeroTier / Nebula** — Makes devices on different networks appear on the same LAN, solving the connectivity layer.
- **Syncthing / Resilio / Nextcloud** — Keeps files synchronized across devices, but with explicit sync boundaries.
- **NFS / SMB / Ceph / Gluster / MooseFS** — Network filesystems, but machines are still separate.
- **VM live migration (VMware vMotion, KVM migration)** — Moves running VMs between hosts, but requires shared storage and compatible hardware.
- **Slurm / HTCondor** — Batch scheduling across clusters, not designed for interactive desktop workloads or mobile devices.

### What They Miss

Each of these solves part of the problem, but none fully achieve the vision because they still expose **machine boundaries** to the user or the application. The key missing pieces:

- A unified scheduler that treats every device in a personal fleet as a resource
- Transparent process migration for interactive workloads (not just batch or VMs)
- A filesystem that spans devices without explicit mount points or sync folders
- Latency-aware placement that works across LAN, mesh, and cellular
- Power-aware scheduling that considers battery impact on both the executing and requesting device
- A security model for personal devices that trusts (but verifies) your own fleet

## Warden Relationship

A useful refinement of this idea is that **Warden is not the whole homogenized-compute system**.

Instead:

- each **leaf Warden** supports, defends, and reports on a single machine
- a **parent Warden** aggregates multiple leaf Wardens into a fleet-level view
- deeper homogenized-compute features like scheduling, dispatch, storage unification, and workload placement may live in parent mode or in a layer above Warden that uses Warden as its substrate

That keeps host defense local while still allowing the fleet to appear as one pool.

See also:

- [warden_hierarchy_design.md](warden_hierarchy_design.md) — review of the current plan and proposed parent / leaf / both hierarchy

## Status

**Exploratory / early-stage concept.** This is a brainstorming document, not an active project.

## Open Questions

1. Should the first implementation target a specific niche (e.g., GPU compute pooling for AI/ML) or go broad from the start?
2. What is the minimum viable expression of this idea? A filesystem that spans machines transparently? A scheduler that can offload builds?
3. How much of this can be built on top of existing kernels, and how much requires new kernel primitives?
4. Is the right starting point a control-plane layer that orchestrates existing tools (NFS + Tailscale + SSH + Slurm-like scheduling), or is a ground-up system needed?
5. How do we handle devices with dramatically different reliability profiles (desktop always-on vs. phone battery-saver vs. laptop in laptop bag vs. NAS on UPS)?
6. Should data be fully replicated across all devices, erasure-coded, or stored with a primary + cache model?
7. Do we trust all devices equally, or is there a trust hierarchy (NAS > desktop > laptop > phone)?

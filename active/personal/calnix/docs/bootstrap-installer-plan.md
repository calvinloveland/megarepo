# Bootable NixOS bootstrap image plan

## Goal

Create a bootable image for new NixOS machines whose main job is to get the machine online quickly and safely so an agent running on an already-configured Calnix machine can inspect the hardware, choose the right host profile, and drive the install remotely.

This should optimize for **connectivity first**, not for a rich local desktop. Once the new machine is reachable, the existing machine can do the smart work.

## Why this fits Calnix

Calnix already has good building blocks:

- `modules/remote-access.nix` already enables SSH, Tailscale, and mosh-friendly firewall rules.
- `modules/desktop.nix` already enables NetworkManager for Wi-Fi and Ethernet management.
- the repo is already flake-based and has host-specific NixOS configurations.

The bootstrap image should reuse those ideas, but with a thinner, installer-oriented profile.

## Core design principles

1. **Outbound-first connectivity**
   - New machines are often behind NAT, on unknown Wi-Fi, or not yet routable.
   - The image should prefer methods where the new machine dials out to become reachable.

2. **No long-lived secrets baked into the image**
   - The image may be copied to many USB sticks.
   - It should not contain reusable Tailscale auth keys, private SSH keys, or host secrets.

3. **Fast path for common cases**
   - Wired DHCP should be essentially zero-touch.
   - Wi-Fi should be possible from a local TUI without needing a full desktop.

4. **Remote-control friendly**
   - The image should expose enough state for the remote agent to understand the machine: disks, NICs, CPU, RAM, GPU, firmware mode, secure boot state, etc.

5. **Recoverable when the fancy path fails**
   - There should be a manual fallback path for bad Wi-Fi, captive portals, or broken overlay networking.

## Proposed architecture

### 1. Controller machine

An already-configured Calnix host acts as the controller.

Responsibilities:

- create one-time bootstrap credentials
- wait for the new machine to appear
- inspect hardware facts from the new machine
- decide which Calnix host profile or installer plan to use
- run the installation remotely
- transition the new host from temporary bootstrap access to permanent Calnix remote access

Potential future command shape:

```bash
calnix bootstrap prepare
calnix bootstrap wait
calnix bootstrap install --target <bootstrap-host>
```

### 2. Bootstrap image

A bootable ISO or USB image with a small NixOS profile focused on:

- network bring-up
- temporary authenticated remote access
- machine inventory collection
- remote install handoff

### 3. Optional rendezvous layer

Best case: avoid a custom rendezvous service by using Tailscale or another overlay with outbound enrollment.

Fallback case: if overlay networking is unavailable, support a reverse tunnel back to the controller.

## Connectivity plan

### Tier 0: Wired auto-connect

On boot:

- start DHCP on Ethernet immediately
- advertise hostname on mDNS if available
- show current IPs on the console
- start the bootstrap agent automatically

This should cover the easiest setup path: plug in Ethernet, boot, connect remotely.

### Tier 1: Local Wi-Fi onboarding

If no usable network appears within a short timeout:

- provide a simple TUI prompt on the primary console
- use NetworkManager + `nmtui` or a minimal wrapper around `nmcli`
- persist Wi-Fi credentials only for the live session unless explicitly told otherwise

Expected local flow:

1. boot image
2. choose Wi-Fi network in TUI
3. machine gets online
4. bootstrap agent starts or retries enrollment

This keeps the local interaction small and avoids needing a full graphical environment.

### Tier 2: Preferred remote reachability via Tailscale

This is the strongest candidate for the primary remote-control path.

Why:

- outbound connection model works well on random home networks
- already used in Calnix
- SSH over Tailnet is simple once the node joins

Recommended pattern:

- the controller creates a **single-use or short-lived auth key**
- the user transfers that key to the bootstrap machine via one of:
  - typed short code
  - QR code shown on controller, scanned locally if camera support exists later
  - USB file dropped onto the installer media or a second USB stick
- the bootstrap image runs `tailscale up` with temporary tags or an ephemeral auth model
- the controller waits for the bootstrap node to appear on the Tailnet
- the controller SSHes to the bootstrap node and takes over

Important security note:

- do **not** hardcode a reusable Tailnet auth key into the ISO
- prefer tagged, time-limited, or single-use enrollment

### Tier 3: Reverse SSH tunnel fallback

If Tailscale fails but the machine has general internet access:

- the bootstrap image should optionally establish a reverse SSH tunnel to the controller
- this works when inbound access is impossible but outbound SSH is allowed

This is a good fallback, but probably should not be the primary path because it is more brittle operationally.

### Tier 4: Same-LAN fallback

If both machines are on the same LAN, support discovery via:

- printed local IP on console
- mDNS hostname announcement
- optional `avahi`

This gives a simple emergency path even without Tailscale.

## Bootstrap authentication model

The current `modules/remote-access.nix` is close, but the installer needs a temporary trust model.

Recommended approach:

- create a dedicated temporary `bootstrap` user for the live environment
- authorize only controller-provided public keys
- disable password login
- rotate or discard bootstrap credentials after install
- never reuse the everyday host user as the installer entry point

Avoid for the bootstrap image:

- default passwords
- persistent private keys shared across installer media
- root SSH login unless there is a very strong reason

## Remote agent workflow

Once the bootstrap image is reachable, the controller agent should do roughly this:

1. **Collect facts**
   - `lsblk`, NVMe/SATA layout, removable media presence
   - `lspci`, `lsusb`, `dmidecode`, `ip link`
   - firmware mode and secure boot state
   - available RAM, CPU, GPU, Wi-Fi chipset

2. **Pick an install strategy**
   - existing known host profile
   - new-host scaffold
   - laptop vs desktop defaults
   - disk layout choice

3. **Generate or update hardware-specific config**
   - derive hardware config on the target
   - copy facts back to the controller repo
   - let the controller review or synthesize the host config

4. **Install remotely**
   - partition and format disks
   - push the chosen flake config
   - install bootloader and system profile

5. **Cut over to normal Calnix remote access**
   - switch from temporary bootstrap SSH/Tailscale setup to the permanent host config
   - verify the installed host comes back online under its real hostname

## Recommended implementation shape in this repo

### New modules

- `modules/bootstrap-connectivity.nix`
  - DHCP / NetworkManager
  - console status output
  - mDNS or local discovery helpers
  - Tailscale bootstrap support

- `modules/bootstrap-agent.nix`
  - systemd service that:
    - waits for network
    - reports machine facts
    - enrolls into remote control path
    - writes status to console and logs

- `modules/bootstrap-ssh.nix`
  - temporary SSH hardening for the live image
  - controller public key injection
  - dedicated temporary bootstrap user

### New host/profile

- `hosts/bootstrap-image/configuration.nix`
  - thin live image profile
  - imports bootstrap modules
  - avoids the full desktop stack

### Flake outputs

Add one or both of:

- `nixosConfigurations.bootstrap-image`
- `packages.x86_64-linux.bootstrap-iso`

The practical output should make it easy to build with a single command such as:

```bash
nix build .#bootstrap-iso
```

## Installation transport options

### Best likely option: remote install from controller over SSH

This is the preferred mental model:

- new machine boots the live image
- controller reaches it over Tailscale or LAN SSH
- controller runs the install remotely

This keeps all the smart logic on the already-configured machine, which matches your goal well.

### Strong candidate tooling to evaluate

- `nixos-anywhere` for remote install orchestration
- `disko` if you want declarative partitioning
- `nixos-facter` or a similar fact collection layer if hardware inventory should be more structured than shell output

These do not need to be adopted immediately, but they are worth evaluating before writing custom install orchestration.

## Console UX for the bootstrap image

At boot, the local console should show a very small, useful status view:

- machine name or temporary bootstrap ID
- Ethernet status
- Wi-Fi status
- Tailscale status
- current reachable addresses
- SSH fingerprint
- next local action if not connected
- short controller instructions

Example:

```text
Calnix Bootstrap
----------------
Ethernet: connected (192.168.1.44)
Wi-Fi: not configured
Tailnet: waiting for auth token
SSH: bootstrap@192.168.1.44
Fingerprint: SHA256:...
Next step: enter bootstrap token or connect via local LAN
```

That alone will save a lot of friction.

## Security boundaries

The bootstrap image should be treated as semi-public media.

So:

- no baked-in reusable secrets
- short-lived enrollment only
- minimal services exposed before authentication
- clear log trail of who connected and when
- automatic cleanup of temporary credentials after install or reboot

If we later add unattended flows, prefer:

- age-encrypted controller metadata
- short-lived signed bootstrap manifests
- tagged Tailnet nodes with limited ACLs

## Suggested phased plan

### Phase 1: minimal viable connectivity

Goal: prove the remote-control loop.

Build a live image that provides:

- Ethernet DHCP
- `nmtui` for Wi-Fi
- temporary SSH access with injected controller pubkey
- optional Tailscale enrollment
- visible console status

Success condition:

- boot a new machine
- get it online
- SSH from the controller machine
- inspect hardware remotely

### Phase 2: controller-driven install

Add:

- controller CLI helpers
- host fact collection
- remote install script or `nixos-anywhere` integration
- copy-back of generated hardware config

Success condition:

- controller can take a reachable bootstrap machine and install a Calnix host end-to-end

### Phase 3: smart host selection

Add:

- hardware classification heuristics
- host template generation for unknown machines
- disk layout policy selection
- post-install validation

Success condition:

- controller can propose the right configuration with minimal human input

### Phase 4: polished onboarding

Add:

- QR or file-based one-time enrollment
- richer console UX
- optional same-LAN discovery helper on the controller
- optional remote progress UI

## Key decisions to make next

1. Is **Tailscale** the primary reachability path, or just a fallback to LAN SSH?
2. Should Wi-Fi onboarding be **pure TUI** or do you want a tiny graphical flow later?
3. Do we want to adopt **`nixos-anywhere`** early, or keep phase 1 fully custom?
4. What disk layout policy should the controller assume for unknown hardware?
5. Should the controller generate a brand-new host directory automatically, or only assist a human-reviewed flow?

## My recommendation

Start with the smallest useful slice:

1. create a bootstrap ISO profile in this flake
2. give it Ethernet + Wi-Fi + temporary SSH + optional Tailscale
3. make the controller machine able to detect and SSH into it
4. only then layer on remote install automation

That sequence keeps the risk low and makes the connectivity problem testable on its own.

```markdown
//---
name: Cluster access notes
description: Capture safe, repeatable steps for accessing a Kubernetes cluster without committing secrets.
version: 0.1.0
owners: - team: engineering
tags: - kubernetes - k3s - operations - access
//---

# Cluster access notes

## Intent

Provide a safe, repeatable workflow for accessing a remote Kubernetes cluster while keeping credentials out of the repo.

## When to use

- You need to access a cluster running on another host.
- You need a checklist that avoids committing secrets.

## Preconditions

- You have SSH access to the cluster host.
- You have a kubeconfig file stored outside the repository (USB, secure location, or remote host).

## Workflow

1. Locate kubeconfig securely
   - If stored on removable media, mount it and identify the kubeconfig file.
   - If stored on the remote host, copy it to your user account with correct permissions.

2. Copy kubeconfig locally (no secrets in repo)
   - Store it under `~/.kube/` with permissions `600`.
   - Example destination: `~/.kube/<cluster-name>.yaml`.

3. Use `kubectl` with an explicit kubeconfig
   - Example: `kubectl --kubeconfig ~/.kube/<cluster-name>.yaml get nodes`.
   - Avoid exporting kubeconfig paths globally unless required.

4. Verify cluster health
   - Check node readiness: `kubectl --kubeconfig ~/.kube/<cluster-name>.yaml get nodes`.
   - Optional: check system pods in `kube-system`.

5. SSH verification (host-level)
   - Confirm the service is running on the host:
     - `systemctl is-active k3s`
     - `ps aux | egrep -i "k3s|kube-apiserver|kubelet|containerd"`

## Safety guidelines

- **Never commit kubeconfig files** or raw certificate/key data.
- Avoid copying kubeconfig into the repository.
- Prefer placeholders in docs: `<cluster-name>`, `<cluster-host>`, `<kubeconfig-file>`.
- Set kubeconfig permissions to `600` after copying.

## Failure modes

- If `kubectl` times out, check network reachability to the API server (port 6443).
- If SSH works but `kubectl` does not, verify kubeconfig `server:` points to the correct host/IP.
- If `systemctl` reports inactive, start or troubleshoot the k3s service on the host.
```

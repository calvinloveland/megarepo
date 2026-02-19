#!/usr/bin/env python3
"""
Python replacement for calnix `rebuild.sh`.

Features:
- Host auto-detection
- Safe handling when invoked with sudo (re-exec as SUDO_USER)
- Repo ownership detection and interactive repair (chown or run build as owner)
- Builds flake as non-root user, then runs switch as root
- Preserves behavior for thinker and 1337book
- Optional --yes to auto-accept chown
"""

from __future__ import annotations

import argparse
import os
import pwd
import grp
import shlex
import shutil
import subprocess
import sys
import time


def format_duration(seconds: int) -> str:
    minutes, secs = divmod(max(0, int(seconds)), 60)
    if minutes:
        return f"{minutes}m {secs}s"
    return f"{secs}s"


def format_eta(elapsed: int, estimate: int | None) -> str:
    if not estimate or estimate <= 0:
        return f"elapsed {format_duration(elapsed)}"

    percent = min(99, int((elapsed / estimate) * 100))
    remaining = max(0, estimate - elapsed)
    return (
        f"elapsed {format_duration(elapsed)} | "
        f"~{percent}% | ETA {format_duration(remaining)}"
    )


def progress_bar(percent: int, width: int = 30) -> str:
    """Generate a simple ASCII progress bar: [====>    ] 45%"""
    filled = max(0, min(width, int((percent / 100.0) * width)))
    bar = "=" * filled + (">" if filled < width else "") + " " * (width - filled - 1)
    return f"[{bar}] {percent}%"


def phase_banner(step: int, total_steps: int, title: str, estimate_seconds: int | None = None) -> None:
    estimate_text = ""
    if estimate_seconds:
        estimate_text = f" (estimated {format_duration(estimate_seconds)})"
    print(f"\n[{step}/{total_steps}] {title}{estimate_text}")
    sys.stdout.flush()


def reexec_if_root():
    """If running as root because of sudo, re-exec as SUDO_USER to avoid
    evaluating flakes as root (causes ownership errors)."""
    if os.geteuid() == 0:
        sudo_user = os.environ.get("SUDO_USER")
        if sudo_user:
            print(f"⚠️  Don't run this script with sudo; re-executing as {sudo_user} to avoid flake ownership errors.")
            os.execvp(
                "sudo",
                [
                    "sudo",
                    "-u",
                    sudo_user,
                    "-E",
                    sys.executable,
                    os.path.realpath(__file__),
                    *sys.argv[1:],
                ],
            )
        else:
            print("❌ This script must not be run as root. Re-run as your normal user (it will use sudo internally).")
            sys.exit(1)


def detect_host() -> str:
    hostname = shutil.which("hostname") and subprocess.check_output(["hostname"]).decode().strip() or os.uname()[1]
    host = hostname.lower()
    if host in ("thinker", "thinker"):
        return "thinker"
    if host in ("1337book", "elitebook"):
        return "1337book"

    # hardware checks (best-effort)
    try:
        lspci = subprocess.check_output(["lspci"]).decode()
        if "thinkpad" in lspci.lower():
            return "thinker"
        if "hewlett-packard" in lspci.lower() or "hp" in lspci.lower():
            return "1337book"
    except Exception:
        pass

    return "thinker"


def get_repo_root() -> str:
    try:
        root = subprocess.check_output(["git", "rev-parse", "--show-toplevel"], stderr=subprocess.DEVNULL).decode().strip()
        return root
    except Exception:
        return os.getcwd()


def uid_to_user(uid: int) -> str:
    try:
        return pwd.getpwuid(uid).pw_name
    except KeyError:
        return str(uid)


def is_container_environment() -> bool:
    return (
        os.path.exists("/.dockerenv")
        or os.environ.get("REMOTE_CONTAINERS")
        or os.environ.get("DEVCONTAINER")
        or os.environ.get("CODESPACES")
    )


def add_git_safe_directory(repo_root: str, as_user: str | None = None) -> bool:
    rc, _ = run_cmd(["git", "config", "--global", "--add", "safe.directory", repo_root], as_user=as_user, capture=False)
    return rc == 0


def ensure_repo_owned_or_fix(non_interactive: bool, auto_yes: bool=False, allow_chown: bool=False) -> tuple[bool, str|None]:
    """Return (ok, build_as_owner_user)."""
    repo_root = get_repo_root()
    try:
        st = os.stat(repo_root)
        repo_owner_uid = st.st_uid
    except Exception:
        return True, None

    my_uid = os.geteuid()
    if repo_owner_uid == my_uid:
        return True, None

    repo_owner_user = uid_to_user(repo_owner_uid)
    me = pwd.getpwuid(my_uid).pw_name
    print(f"⚠️  Repository {repo_root} is owned by {repo_owner_user} (uid {repo_owner_uid}), but you are {me} (uid {my_uid}).")
    print("    Nix flake evaluation may fail when run as a different user (you've seen: 'repository path ... is not owned by current user').")

    if non_interactive:
        print(f"    Non-interactive: run on host: sudo chown -R {me}:{grp.getgrgid(pwd.getpwuid(my_uid).pw_gid).gr_name} '{repo_root}' or run the rebuild as the repo owner.")
        return False, None

    in_container = is_container_environment()
    group_name = grp.getgrgid(pwd.getpwuid(my_uid).pw_gid).gr_name

    # In containers, chowning the bind-mounted repo can fight host ownership.
    # Prefer adding a git safe.directory entry instead unless explicitly allowed.
    if in_container and not allow_chown:
        if auto_yes:
            ans = "y"
        else:
            ans = input(f"    Add git safe.directory for '{repo_root}' instead of chowning? [Y/n] ") or "Y"
        if ans.lower().startswith("y"):
            if add_git_safe_directory(repo_root):
                print("    ✅ Added git safe.directory for this repo; proceeding without chown.")
                return True, None
            print("    ⚠️  Failed to add git safe.directory. You may need to run: git config --global --add safe.directory '<repo>'")
            return False, None

    # Offer to chown (host-safe or explicitly allowed in container)
    if auto_yes:
        ans = "y"
    else:
        chown_suggestion = f"sudo chown -R {me}:{group_name} '{repo_root}'"
        ans = input(f"    Fix ownership now by running '{chown_suggestion}'? [Y/n] ") or "Y"
    if ans.lower().startswith("y"):
        cmd = ["sudo", "chown", "-R", f"{me}:{group_name}", repo_root]
        try:
            subprocess.check_call(cmd)
            print(f"    ✅ Ownership fixed to {me}:{group_name}.")
            return True, None
        except subprocess.CalledProcessError:
            print("    ⚠️  Failed to chown. You may need to run the chown on the host or adjust mount options.")
            return False, None

    # Offer to run build as repo owner
    ans2 = input(f"    Or run the build as {repo_owner_user} using sudo - this requires your sudo password and will execute build steps as that user. Proceed? [y/N] ")
    if ans2.lower().startswith("y"):
        return True, repo_owner_user

    print("    Aborting rebuild due to ownership mismatch. Fix ownership or re-run as the repo owner.")
    return False, None


def run_cmd(cmd: list[str], as_user: str|None=None, capture: bool=False) -> tuple[int, str]:
    """Run a command and optionally capture output (simple, non-streaming).

    For long-running commands where progress is useful, prefer using
    `run_cmd_stream` which streams stdout and provides heartbeats.
    """
    if as_user:
        shell_cmd = " ".join(shlex.quote(c) for c in cmd)
        full = ["sudo", "-u", as_user, "-H", "bash", "-lc", shell_cmd]
        proc = subprocess.run(full, stdout=subprocess.PIPE if capture else None, stderr=subprocess.STDOUT if capture else None)
        out = proc.stdout.decode().strip() if capture and proc.stdout else ""
        return proc.returncode, out

    proc = subprocess.run(cmd, stdout=subprocess.PIPE if capture else None, stderr=subprocess.STDOUT if capture else None)
    out = proc.stdout.decode().strip() if capture and proc.stdout else ""
    return proc.returncode, out


def run_cmd_stream(
    cmd: list[str],
    as_user: str | None = None,
    capture: bool = True,
    verbose: bool = False,
    heartbeat: int = 10,
    label: str = "cmd",
    estimate_seconds: int | None = None,
) -> tuple[int, str]:
    """Run a command and stream output to the console while capturing it.

    - If `as_user` is provided, the command will be executed via sudo -u.
    - If `verbose` is True, print each output line.
    - Uses in-place terminal updates (progress bar) to avoid console spam.
    - `heartbeat` controls how many seconds of silence before updating progress.

    Returns (returncode, captured_output).
    """
    if as_user:
        shell_cmd = " ".join(shlex.quote(c) for c in cmd)
        full = ["sudo", "-u", as_user, "-H", "bash", "-lc", shell_cmd]
    else:
        full = cmd

    if verbose:
        print(f"$ {' '.join(shlex.quote(p) for p in full)}")

    try:
        proc = subprocess.Popen(full, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    except Exception as exc:
        print(f"Failed to start command: {exc}")
        return 1, ""

    out_lines: list[str] = []
    last_output = 0
    start_time = last_output = int(time.time())

    # Print start message once
    status_line = f"[{label}] started"
    if estimate_seconds:
        status_line += f" (est. {format_duration(estimate_seconds)})"
    print(status_line, end="", flush=True)

    try:
        while True:
            line = proc.stdout.readline()
            now = int(time.time())
            if line:
                line = line.rstrip('\n')
                out_lines.append(line)
                # Only print output if verbose; suppress spam from normal builds
                if verbose:
                    print(f"\r[{label}] {line:<100}", flush=True)
                last_output = now
            else:
                if proc.poll() is not None:
                    break
                # Update progress line in-place
                if now - last_output >= heartbeat or (now - start_time) % 2 == 0:
                    elapsed = now - start_time
                    pct = 0
                    if estimate_seconds and estimate_seconds > 0:
                        pct = min(100, int((elapsed / estimate_seconds) * 100))
                    bar = progress_bar(pct)
                    eta_str = format_eta(elapsed, estimate_seconds)
                    # Use carriage return to update line in place
                    print(f"\r[{label}] {bar} {eta_str:<40}", end="", flush=True)
                    last_output = now
                # small sleep to avoid busy loop
                time.sleep(0.5)

        ret = proc.wait()
    except KeyboardInterrupt:
        try:
            proc.terminate()
        except Exception:
            pass
        proc.wait()
        # Clear the progress line
        print(f"\r[{label}] interrupted{' ' * 60}", flush=True)
        raise

    # Final status: move to a fresh line and print summary
    captured = "\n".join(out_lines) if capture else ""
    total_elapsed = int(time.time()) - start_time
    print(f"\r[{label}] {progress_bar(100)} {format_duration(total_elapsed):<40}")
    return ret, captured


def build_and_switch_flake(flake_expr: str, target: str, extra_args: list[str], build_as_owner: str|None, non_interactive: bool, verbose: bool=False) -> bool:
    phase_banner(2, 4, f"Build system derivation for {target}", estimate_seconds=180)
    nix_cmd = ["nix", "--extra-experimental-features", "nix-command flakes", "build", "--print-out-paths", flake_expr, "--no-link"]
    # Use streaming command for builds so users get progress output for long builds
    if build_as_owner:
        print(f"Running flake build as {build_as_owner} to avoid ownership checks...")
        rc, out = run_cmd_stream(
            nix_cmd,
            as_user=build_as_owner,
            capture=True,
            verbose=verbose,
            label="build",
            estimate_seconds=180,
        )
        if rc != 0:
            print("Flake build failed when run as repo owner.")
            return False
        build_out = out.splitlines()[-1] if out else ""
    else:
        print(f"Building flake as {pwd.getpwuid(os.geteuid()).pw_name} to avoid ownership errors...")
        rc, out = run_cmd_stream(
            nix_cmd,
            as_user=None,
            capture=True,
            verbose=verbose,
            label="build",
            estimate_seconds=180,
        )
        if rc != 0:
            print("Flake build failed as current user. This often indicates ownership or flake input problems.")
            print("Consider re-running the script and allowing it to chown the repo, or run the build as the repo owner.")
            return False
        build_out = out.splitlines()[-1] if out else ""

    if not build_out:
        print("Build produced no output path; aborting.")
        return False

    print(f"Build output: {build_out}")

    candidate = os.path.join(build_out, "bin", "switch-to-configuration")
    if not os.path.exists(candidate):
        phase_banner(3, 4, "Fallback: build toplevel output", estimate_seconds=120)
        print("switch-to-configuration not found in build output; attempting to build the system toplevel and try again...")
        toplevel_expr = flake_expr.replace("config.system.build.nixos-rebuild", "config.system.build.toplevel")
        if build_as_owner:
            rc2, out2 = run_cmd_stream(
                ["nix", "--extra-experimental-features", "nix-command flakes", "build", "--print-out-paths", toplevel_expr, "--no-link"],
                as_user=build_as_owner,
                capture=True,
                verbose=verbose,
                label="fallback-build",
                estimate_seconds=120,
            )
        else:
            rc2, out2 = run_cmd_stream(
                ["nix", "--extra-experimental-features", "nix-command flakes", "build", "--print-out-paths", toplevel_expr, "--no-link"],
                capture=True,
                verbose=verbose,
                label="fallback-build",
                estimate_seconds=120,
            )
        if rc2 != 0:
            print("Failed to build toplevel; cannot find switch-to-configuration.")
            return False
        build_out = out2.splitlines()[-1] if out2 else build_out
        candidate = os.path.join(build_out, "bin", "switch-to-configuration")

    if not os.path.exists(candidate):
        print(f"switch-to-configuration not found at expected locations (checked {candidate}). Cannot proceed automatically.")
        return False

    phase_banner(4, 4, "Activate new configuration", estimate_seconds=45)
    switch_cmd = [candidate, "switch"]
    if os.geteuid() != 0:
        # need sudo to switch
        rc, _ = run_cmd_stream(["sudo", *switch_cmd], capture=False, verbose=verbose, label="switch", estimate_seconds=45)
    else:
        rc, _ = run_cmd_stream(switch_cmd, capture=False, verbose=verbose, label="switch", estimate_seconds=45)
    return rc == 0


def main(argv: list[str] | None = None):
    reexec_if_root()
    parser = argparse.ArgumentParser()
    parser.add_argument("host", nargs="?", choices=["thinker", "1337book"], help="Host target")
    parser.add_argument("--yes", action="store_true", help="Auto-accept ownership fix (non-interactive) or chown)")
    parser.add_argument("--dry-run", action="store_true", help="Dry run (pass-through) but we still validate ownership)")
    parser.add_argument("-v", "--verbose", action="store_true", help="Show verbose progress and command output")
    parser.add_argument("--allow-chown", action="store_true", help="Allow chown in container environments (not recommended)")
    parser.add_argument("extra", nargs=argparse.REMAINDER, help="Extra args to pass to nixos-rebuild")
    args = parser.parse_args(argv)

    host = args.host or detect_host()
    print(f"Auto-detected host: {host}")

    # If non-interactive input, decide accordingly
    non_interactive = not sys.stdin.isatty()

    if host in ("thinker", "1337book"):
        print(f"💻 Rebuilding {host} configuration...")
        phase_banner(1, 4, "Validate repository ownership", estimate_seconds=15)

        ok, build_as_owner = ensure_repo_owned_or_fix(non_interactive, auto_yes=args.yes, allow_chown=args.allow_chown)
        if not ok and not build_as_owner:
            sys.exit(1)

        flake_expr = f".#nixosConfigurations.\"{host}\".config.system.build.nixos-rebuild"
        success = build_and_switch_flake(flake_expr, host, args.extra or [], build_as_owner, non_interactive, verbose=args.verbose)
        if success:
            print("Done!")
            if host == "thinker":
                print("Restarting waybar service...")
                subprocess.call(["systemctl", "--user", "restart", "waybar"])  # best-effort
            sys.exit(0)
        else:
            sys.exit(1)

    print(f"Unknown host: {host}")
    sys.exit(1)


if __name__ == "__main__":
    main()

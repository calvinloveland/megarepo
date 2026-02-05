#!/usr/bin/env python3
"""
Python replacement for calnix `rebuild.sh`.

Features:
- Host auto-detection (WSL-safe)
- Safe handling when invoked with sudo (re-exec as SUDO_USER)
- Repo ownership detection and interactive repair (chown or run build as owner)
- Builds flake as non-root user, then runs switch as root
- Preserves behavior for thinker, 1337book, work-wsl
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
    # WSL detection
    if os.path.exists("/proc/version"):
        try:
            with open("/proc/version", "r") as f:
                v = f.read()
            if "microsoft" in v.lower():
                return "work-wsl"
        except Exception:
            pass

    if os.environ.get("WSL_DISTRO_NAME"):
        return "work-wsl"

    hostname = shutil.which("hostname") and subprocess.check_output(["hostname"]).decode().strip() or os.uname()[1]
    host = hostname.lower()
    if host in ("thinker", "thinker"):
        return "thinker"
    if host in ("1337book", "elitebook"):
        return "1337book"
    if host in ("work-wsl", "work"):
        return "work-wsl"

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


def ensure_repo_owned_or_fix(non_interactive: bool, auto_yes: bool=False) -> tuple[bool, str|None]:
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

    # Offer to chown
    if auto_yes:
        ans = "y"
    else:
        group_name = grp.getgrgid(pwd.getpwuid(my_uid).pw_gid).gr_name
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
    if as_user:
        shell_cmd = " ".join(shlex.quote(c) for c in cmd)
        full = ["sudo", "-u", as_user, "-H", "bash", "-lc", shell_cmd]
        proc = subprocess.run(full, stdout=subprocess.PIPE if capture else None, stderr=subprocess.STDOUT if capture else None)
        out = proc.stdout.decode().strip() if capture and proc.stdout else ""
        return proc.returncode, out

    proc = subprocess.run(cmd, stdout=subprocess.PIPE if capture else None, stderr=subprocess.STDOUT if capture else None)
    out = proc.stdout.decode().strip() if capture and proc.stdout else ""
    return proc.returncode, out


def build_and_switch_flake(flake_expr: str, target: str, extra_args: list[str], build_as_owner: str|None, non_interactive: bool) -> bool:
    nix_cmd = ["nix", "--extra-experimental-features", "nix-command flakes", "build", "--print-out-paths", flake_expr, "--no-link"]
    if build_as_owner:
        print(f"Running flake build as {build_as_owner} to avoid ownership checks...")
        rc, out = run_cmd(nix_cmd, as_user=build_as_owner, capture=True)
        if rc != 0:
            print("Flake build failed when run as repo owner.")
            return False
        build_out = out.splitlines()[-1] if out else ""
    else:
        print(f"Building flake as {pwd.getpwuid(os.geteuid()).pw_name} to avoid ownership errors...")
        rc, out = run_cmd(nix_cmd, as_user=None, capture=True)
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
        print("switch-to-configuration not found in build output; attempting to build the system toplevel and try again...")
        toplevel_expr = flake_expr.replace("config.system.build.nixos-rebuild", "config.system.build.toplevel")
        if build_as_owner:
            rc2, out2 = run_cmd(["nix", "--extra-experimental-features", "nix-command flakes", "build", "--print-out-paths", toplevel_expr, "--no-link"], as_user=build_as_owner, capture=True)
        else:
            rc2, out2 = run_cmd(["nix", "--extra-experimental-features", "nix-command flakes", "build", "--print-out-paths", toplevel_expr, "--no-link"], capture=True)
        if rc2 != 0:
            print("Failed to build toplevel; cannot find switch-to-configuration.")
            return False
        build_out = out2.splitlines()[-1] if out2 else build_out
        candidate = os.path.join(build_out, "bin", "switch-to-configuration")

    if not os.path.exists(candidate):
        print(f"switch-to-configuration not found at expected locations (checked {candidate}). Cannot proceed automatically.")
        return False

    switch_cmd = [candidate, "switch"]
    if os.geteuid() != 0:
        # need sudo to switch
        rc, _ = run_cmd(["sudo", *switch_cmd], capture=False)
    else:
        rc, _ = run_cmd(switch_cmd, capture=False)
    return rc == 0


def main(argv: list[str] | None = None):
    reexec_if_root()
    parser = argparse.ArgumentParser()
    parser.add_argument("host", nargs="?", choices=["thinker", "1337book", "work-wsl"], help="Host target")
    parser.add_argument("--yes", action="store_true", help="Auto-accept ownership fix (non-interactive) or chown)")
    parser.add_argument("--dry-run", action="store_true", help="Dry run (pass-through) but we still validate ownership)")
    parser.add_argument("extra", nargs=argparse.REMAINDER, help="Extra args to pass to nixos-rebuild")
    args = parser.parse_args(argv)

    host = args.host or detect_host()
    print(f"Auto-detected host: {host}")

    # If non-interactive input, decide accordingly
    non_interactive = not sys.stdin.isatty()

    if host == "work-wsl":
        print("🖱️  Rebuilding WSL work configuration...")
        cmd = ["sudo", "nixos-rebuild", "switch", "--flake", ".#work-wsl"]
        if args.extra:
            cmd.extend(args.extra)
        rc = subprocess.call(cmd)
        sys.exit(rc)

    if host in ("thinker", "1337book"):
        print(f"💻 Rebuilding {host} configuration...")

        ok, build_as_owner = ensure_repo_owned_or_fix(non_interactive, auto_yes=args.yes)
        if not ok and not build_as_owner:
            sys.exit(1)

        flake_expr = f".#nixosConfigurations.\"{host}\".config.system.build.nixos-rebuild"
        success = build_and_switch_flake(flake_expr, host, args.extra or [], build_as_owner, non_interactive)
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

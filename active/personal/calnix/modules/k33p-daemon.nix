{
  config,
  pkgs,
  lib,
  ...
}:
let
  cfg = config.calnix.k33pDaemon;

  # Build a python environment with the deps k33p needs (pyyaml + textual)
  k33pPythonEnv = pkgs.python3.withPackages (ps: [ ps.pyyaml ps.textual ]);

  # Wrapper script that runs the k33p daemon continuously from the megarepo
  # source tree.  The daemon polls for file changes every 2s, creates a k33p
  # commit after the debounce period (30s), and pushes to git when the
  # push_after timer (5m) has elapsed.
  k33pDaemonWrapper = pkgs.writeShellScript "k33p-daemon" ''
    set -euo pipefail
    export PYTHONPATH="${cfg.projectPath}/active/dev-tools/k33p/src"
    cd "${cfg.projectPath}"
    exec ${k33pPythonEnv}/bin/python3 -m k33p daemon
  '';

  # Companion sync script: rebase local auto-commits onto origin on a timer.
  #
  # A fast-forward-only pull silently wedges any pair of hosts that both run the
  # commit daemon: each commits locally, the first push wins, and the other host
  # can never fast-forward again. Rebase instead, and fail loudly (with the
  # conflicted paths) when the rebase genuinely conflicts so the divergence is
  # visible in the journal instead of looping every 5 minutes.
  k33pPullWrapper = pkgs.writeShellScript "k33p-pull" ''
    set -euo pipefail
    repo="''${1:-${cfg.projectPath}}"
    cd "$repo"

    if [ -n "$(${pkgs.git}/bin/git status --porcelain)" ]; then
      echo "[k33p-sync] skipping pull for $repo: working tree is dirty"
      exit 0
    fi

    if ! ${pkgs.git}/bin/git fetch --quiet origin main; then
      echo "[k33p-sync] ERROR: could not fetch origin/main" >&2
      exit 1
    fi

    if ${pkgs.git}/bin/git merge-base --is-ancestor origin/main HEAD; then
      echo "[k33p-sync] up to date at $(${pkgs.git}/bin/git rev-parse --short HEAD)"
      exit 0
    fi

    echo "[k33p-sync] rebasing $(${pkgs.git}/bin/git rev-list --count origin/main..HEAD) local commit(s) onto origin/main"
    if ${pkgs.git}/bin/git rebase origin/main; then
      echo "[k33p-sync] rebased onto $(${pkgs.git}/bin/git rev-parse --short origin/main)"
      exit 0
    fi

    conflicts="$(${pkgs.git}/bin/git diff --name-only --diff-filter=U | tr '\n' ' ')"
    ${pkgs.git}/bin/git rebase --abort || true
    echo "[k33p-sync] ERROR: local commits conflict with origin/main; manual reconcile needed" >&2
    if [ -n "$conflicts" ]; then
      echo "[k33p-sync] conflicted files: $conflicts" >&2
    fi
    echo "[k33p-sync] fix with: git -C $repo pull --rebase origin main" >&2
    exit 1
  '';
in
{
  options.calnix.k33pDaemon = {
    enable = lib.mkEnableOption "k33p daemon — watches for changes and auto-commits to git";

    projectPath = lib.mkOption {
      type = lib.types.str;
      default = "/home/calvin/megarepo";
      description = "Path to the k33p project (megarepo root)";
    };

    pullInterval = lib.mkOption {
      type = lib.types.str;
      default = "5m";
      description = "How often the companion git pull timer should try to fast-forward a clean worktree.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.k33p-daemon = {
      description = "k33p daemon — auto-commit and push for megarepo";
      after = [ "network.target" "network-online.target" ];
      wants = [ "network-online.target" ];
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        Type = "simple";
        ExecStart = k33pDaemonWrapper;
        User = "calvin";
        Restart = "on-failure";
        RestartSec = "10";
        TimeoutStartSec = "600";
        MemoryMax = "512M";
        StandardOutput = "journal+console";
        StandardError = "journal";
      };
    };

    systemd.services.k33p-pull = {
      description = "k33p companion sync — fast-forward megarepo from origin when clean";
      after = [ "network.target" "network-online.target" ];
      wants = [ "network-online.target" ];
      serviceConfig = {
        Type = "oneshot";
        ExecStart = k33pPullWrapper;
        User = "calvin";
        TimeoutStartSec = "300";
        StandardOutput = "journal+console";
        StandardError = "journal";
      };
    };

    systemd.timers.k33p-pull = {
      description = "Periodic k33p companion pull for megarepo";
      wantedBy = [ "timers.target" ];
      timerConfig = {
        OnBootSec = "2m";
        OnUnitActiveSec = cfg.pullInterval;
        Persistent = true;
      };
    };
  };
}

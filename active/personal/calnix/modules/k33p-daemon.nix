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
in
{
  options.calnix.k33pDaemon = {
    enable = lib.mkEnableOption "k33p daemon — watches for changes and auto-commits to git";

    projectPath = lib.mkOption {
      type = lib.types.str;
      default = "/home/calvin/megarepo";
      description = "Path to the k33p project (megarepo root)";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.k33p-daemon = {
      description = "k33p daemon — auto-commit and push for megarepo";
      after = [ "network.target" "network-online.target" ];
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
  };
}

{
  config,
  pkgs,
  lib,
  ...
}:
let
  cfg = config.calnix.warden;

  # Source tree: all Warden Python scripts
  wardenSource = pkgs.runCommand "warden-source" { } ''
    mkdir -p "$out"
    cp -r ${./.}/*.py "$out/"
    mkdir -p "$out/checks"
    cp ${./.}/checks/*.py "$out/checks/"
  '';

  # wardenctl CLI entry point
  wardenctl = pkgs.writeShellApplication {
    name = "wardenctl";
    runtimeInputs = with pkgs; [
      python3
      lm_sensors
      coreutils
      gnugrep
      systemd
      tailscale
    ];
    text = ''
      export WARDEN_STATE_DIR=${cfg.stateDir}
      exec ${pkgs.python3}/bin/python3 ${wardenSource}/wardenctl.py "$@"
    '';
  };

  # Check runner (used by systemd timer)
  runChecks = pkgs.writeShellScript "warden-run-checks" ''
    export WARDEN_STATE_DIR=${cfg.stateDir}
    ${pkgs.python3}/bin/python3 ${wardenSource}/runner.py "$@"
  '';

  # Format state dir as tmpfiles rules
  stateDirs = [
    "d ${cfg.stateDir} 0755 warden warden - -"
    "d ${cfg.stateDir}/checks 0755 warden warden - -"
    "d ${cfg.stateDir}/peers 0755 warden warden - -"
    "Z ${cfg.stateDir} 0755 warden warden - -"
    "Z ${cfg.stateDir}/checks 0755 warden warden - -"
    "Z ${cfg.stateDir}/peers 0755 warden warden - -"
  ];

  # Build the check timer list
  enabledChecks = lib.filterAttrs (name: checkCfg: checkCfg.enable) cfg.checks;

  # Helper to convert check name to a systemd-safe name
  sanitizeName = name: builtins.replaceStrings ["-"] ["_"] name;

in
{
  options.calnix.warden = {
    enable = lib.mkEnableOption "Warden per-host monitoring agent";

    stateDir = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/warden";
      description = "Warden state directory";
    };

    checks = lib.mkOption {
      description = "Health check configuration";
      default = { };
      type = lib.types.attrsOf (lib.types.submodule ({
        options = {
          enable = lib.mkEnableOption "this health check";
          interval = lib.mkOption {
            type = lib.types.str;
            default = "10min";
            description = "How often to run this check (systemd timer format)";
          };
          thresholds = lib.mkOption {
            type = lib.types.attrsOf lib.types.ints.unsigned;
            default = { };
            description = "Check-specific thresholds (e.g., warn=80, fail=95)";
          };
          exclude = lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [ ];
            description = "Check-specific exclusions (e.g., filesystem paths)";
          };
          extraConfig = lib.mkOption {
            type = lib.types.attrsOf lib.types.anything;
            default = { };
            description = "Additional check-specific configuration";
          };
        };
      }));
    };

    backups = {
      enable = lib.mkEnableOption "Warden backup management";

      tool = lib.mkOption {
        type = lib.types.str;
        default = "restic";
        description = "Backup tool to use (restic currently supported)";
      };

      repositories = lib.mkOption {
        type = lib.types.attrsOf (lib.types.submodule ({
          options = {
            type = lib.mkOption {
              type = lib.types.enum [ "local" "sftp" "rest" ];
              default = "local";
              description = "Repository type";
            };
            path = lib.mkOption {
              type = lib.types.str;
              description = "Repository path (local path or remote path for sftp)";
            };
            host = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "SFTP host (for type=sftp)";
            };
            passwordFile = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Path to restic password file";
            };
            schedule = lib.mkOption {
              type = lib.types.str;
              default = "daily";
              description = "Backup schedule (systemd OnCalendar format)";
            };
            retention = lib.mkOption {
              type = lib.types.attrsOf lib.types.ints.unsigned;
              default = { keep-daily = 7; keep-weekly = 4; keep-monthly = 6; };
              description = "Restic retention policy";
            };
            paths = lib.mkOption {
              type = lib.types.listOf lib.types.str;
              default = [ ];
              description = "Paths to back up";
            };
            exclude = lib.mkOption {
              type = lib.types.listOf lib.types.str;
              default = [ "*.cache" "node_modules" ".venv" "__pycache__" ];
              description = "Exclude patterns";
            };
            timeout = lib.mkOption {
              type = lib.types.ints.unsigned;
              default = 7200;
              description = "Backup timeout in seconds";
            };
            enable = lib.mkEnableOption "this backup repository";
          };
        }));
        default = { };
        description = "Backup repository configurations";
      };

      preHook = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Shell command to run before backups (e.g., database dump)";
      };

      postHook = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Shell command to run after backups";
      };
    };

    peerApi = {
      enable = lib.mkEnableOption "Warden HTTP API daemon (wardend) for peer communication";
      port = lib.mkOption {
        type = lib.types.port;
        default = 9090;
        description = "Port for the Warden HTTP API";
      };
    };

    peers = lib.mkOption {
      type = lib.types.attrsOf (lib.types.submodule ({
        options = {
          host = lib.mkOption {
            type = lib.types.str;
            description = "Tailscale hostname or IP of peer Warden";
          };
          port = lib.mkOption {
            type = lib.types.port;
            default = 9090;
            description = "Warden HTTP API port";
          };
          enabled = lib.mkEnableOption "this peer connection";
        };
      }));
      default = { };
      description = "Peer Warden hosts for inter-warden communication";
    };

    autoRemediate = {
      enable = lib.mkEnableOption "auto-remediation of failing checks";
      interval = lib.mkOption {
        type = lib.types.str;
        default = "hourly";
        description = "How often to run auto-remediation (OnCalendar format)";
      };
    };

    dashboard = {
      enable = lib.mkEnableOption "Warden web dashboard (Flask UI showing all hosts)";
      port = lib.mkOption {
        type = lib.types.port;
        default = 9091;
        description = "Port for the dashboard web UI";
      };
    };

    pi = {
      enable = lib.mkEnableOption "Pi integration (load Warden extension into Pi)";

      autopilot = {
        enable = lib.mkEnableOption "persistent Pi autopilot Warden session";

        model = lib.mkOption {
          type = lib.types.str;
          default = "opencode-go/deepseek-v4-flash";
          description = "Model to use for the autopilot Warden agent";
        };

        interval = lib.mkOption {
          type = lib.types.str;
          default = "30min";
          description = "How often the autopilot checks and remediates (OnCalendar format)";
        };
      };
    };
  };

  config = lib.mkIf cfg.enable {
    # Dedicated warden system user with passwordless sudo
    users.groups.warden = { };
    users.users.warden = {
      isSystemUser = true;
      group = "warden";
      description = "Warden per-host monitoring agent";
      home = cfg.stateDir;
      createHome = false;
      shell = pkgs.bash;
    };
    users.users.calvin.extraGroups = [ "warden" ];

    # Warden user gets passwordless sudo for system operations
    security.sudo.extraRules = [{
      users = [ "warden" ];
      commands = [{
        command = "ALL";
        options = [ "NOPASSWD" ];
      }];
    }];

    # State directory + Pi extension symlink
    systemd.tmpfiles.rules = stateDirs
      ++ lib.optionals cfg.pi.enable [
        "L+ /home/calvin/.pi/agent/extensions/pi-warden.ts - - - - ${./../../pi-packages/pi-warden/extensions/warden.ts}"
      ];



    # Systemd services: check services + identity init + optional gen recording + wardend daemon
    systemd.services =
      let
        checkServices = lib.mapAttrs' (checkName: checkCfg: {
          name = "warden-check-${sanitizeName checkName}";
          value = {
            description = "Warden check: ${checkName}";
            after = [ "network.target" ];
            serviceConfig = {
              Type = "oneshot";
              ExecStart = "${runChecks} --check ${checkName}";
              User = "warden";
              Group = "warden";
              NoNewPrivileges = true;
              ProtectSystem = "strict";
              ProtectHome = true;
              PrivateTmp = true;
              ProtectProc = "default";
              ReadWritePaths = [ cfg.stateDir ];
              MemoryMax = "256M";
              TimeoutStartSec = "30";
            };
          };
        }) enabledChecks;

        wardenInit = {
          warden-init = {
            description = "Initialize Warden identity and state";
            wantedBy = [ "multi-user.target" ];
            before = lib.mapAttrsToList (name: _: "warden-check-${sanitizeName name}.service") enabledChecks;
            serviceConfig = {
              Type = "oneshot";
              RemainAfterExit = true;
              ExecStart = "${wardenctl}/bin/wardenctl identify";
              User = "warden";
              Group = "warden";
              ReadWritePaths = [ cfg.stateDir ];
              StandardOutput = "null";
              StandardError = "journal";
            };
          };
        };

        recordGeneration = lib.optionalAttrs (config ? calnix && config.calnix ? stateDir) {
          warden-record-generation = let
            recordGenPy = pkgs.writeText "warden-record-generation.py" ''
              import json, os
              wd = os.environ.get("WARDEN_STATE_DIR", "/var/lib/warden")
              state_file = os.path.join(wd, "state.json")
              gen = os.environ.get("NIXOS_GENERATION", "unknown")
              if os.path.exists(state_file):
                  with open(state_file) as f:
                      state = json.load(f)
                  state.setdefault("generation", {})
                  state["generation"]["current"] = gen
                  state["generation"]["last_rebuild"] = {
                      "result": "success",
                      "timestamp": os.popen("date -Iseconds").read().strip(),
                  }
                  with open(state_file, "w") as f:
                      json.dump(state, f, indent=2, sort_keys=True)
            '';
            recordGenSh = pkgs.writeShellScript "warden-record-gen" ''
              export WARDEN_STATE_DIR=${cfg.stateDir}
              GEN=$(nixos-version --json 2>/dev/null | ${pkgs.jq}/bin/jq -r '.configurationRevision // "unknown"' || echo "unknown")
              export NIXOS_GENERATION="$GEN"
              exec ${pkgs.python3}/bin/python3 ${recordGenPy}
            '';
          in {
            description = "Record NixOS generation in Warden state";
            wantedBy = [ "multi-user.target" ];
            serviceConfig = {
              Type = "oneshot";
              RemainAfterExit = true;
              ExecStart = recordGenSh;
              User = "warden";
              Group = "warden";
              ReadWritePaths = [ cfg.stateDir config.calnix.stateDir ];
            };
          };
        };

        wardend = lib.optionalAttrs cfg.peerApi.enable {
          wardend = {
            description = "Warden HTTP API daemon for inter-warden communication";
            after = [ "network.target" "tailscaled.service" ];
            wantedBy = [ "multi-user.target" ];
            serviceConfig = {
              Type = "simple";
              ExecStart = ''${pkgs.python3}/bin/python3 ${wardenSource}/wardend.py --port ${toString cfg.peerApi.port}'';
              User = "warden";
              Group = "warden";
              Restart = "on-failure";
              RestartSec = "10";
              ReadWritePaths = [ cfg.stateDir ];
              ProtectProc = "default";
              PrivateTmp = true;
              MemoryMax = "128M";
              TimeoutStartSec = "30";
            };
          };
        };
        backupServices = lib.optionalAttrs cfg.backups.enable (
          lib.mapAttrs' (repoName: repoCfg: {
            name = "warden-backup-${sanitizeName repoName}";
            value = {
              description = "Warden backup: ${repoName}";
              after = [ "network.target" ];
              serviceConfig = {
                Type = "oneshot";
                ExecStart = ''${pkgs.python3}/bin/python3 ${wardenSource}/backup_runner.py run --repository ${repoName}'';
                User = "warden";
                Group = "warden";
                ReadWritePaths = [ cfg.stateDir ] ++ repoCfg.paths;
                MemoryMax = "512M";
                TimeoutStartSec = "${toString repoCfg.timeout}";
              };
            };
          }) (lib.filterAttrs (n: r: r.enable) cfg.backups.repositories)
        );

        backupCheckServices = lib.optionalAttrs cfg.backups.enable (
          lib.mapAttrs' (repoName: repoCfg: {
            name = "warden-backup-check-${sanitizeName repoName}";
            value = {
              description = "Warden backup integrity check: ${repoName}";
              after = [ "network.target" ];
              serviceConfig = {
                Type = "oneshot";
                ExecStart = ''${pkgs.python3}/bin/python3 ${wardenSource}/backup_runner.py check --repository ${repoName}'';
                User = "warden";
                Group = "warden";
                ReadWritePaths = [ cfg.stateDir ];
                MemoryMax = "512M";
                TimeoutStartSec = "7200";
              };
            };
          }) (lib.filterAttrs (n: r: r.enable) cfg.backups.repositories)
        );

        autoRemediateService = lib.optionalAttrs cfg.autoRemediate.enable {
          "warden-auto-remediate" = {
            description = "Auto-remediate failing Warden checks";
            after = [ "network.target" ];
            serviceConfig = {
              Type = "oneshot";
              ExecStart = ''${pkgs.python3}/bin/python3 ${wardenSource}/remediation.py run-all'';
              User = "warden";
              Group = "warden";
              ReadWritePaths = [ cfg.stateDir ];
              MemoryMax = "256M";
              TimeoutStartSec = "300";
            };
          };
        };
        dashboardApp = lib.optionalAttrs cfg.dashboard.enable {
          warden-dashboard = {
            description = "Warden web dashboard (Flask)";
            after = [ "network.target" ];
            wantedBy = [ "multi-user.target" ];
            serviceConfig = {
              Type = "simple";
              ExecStart = ''${pkgs.python3}/bin/python3 ${wardenSource}/dashboard/app.py --port ${toString cfg.dashboard.port}'';
              User = "warden";
              Group = "warden";
              Restart = "on-failure";
              RestartSec = "10";
              ReadWritePaths = [ cfg.stateDir ];
              ProtectProc = "default";
              PrivateTmp = true;
              MemoryMax = "256M";
              TimeoutStartSec = "30";
            };
          };
        };

        dashboardServices = {
          warden-banner = {
            description = "Show Warden health status on console";
            after = [ "network.target" ];
            wantedBy = [ "multi-user.target" ];
            serviceConfig = {
              Type = "oneshot";
              RemainAfterExit = true;
              ExecStart = ''${pkgs.bash}/bin/bash ${./warden-banner.sh} > /dev/tty1 2>/dev/null || true'';
              StandardOutput = "null";
              StandardError = "journal+console";
            };
          };
          warden-motd = {
            description = "Update MOTD with Warden status";
            after = [ "warden-init.service" ];
            wantedBy = [ "multi-user.target" ];
            serviceConfig = {
              Type = "oneshot";
              RemainAfterExit = true;
              ExecStart = ''${pkgs.bash}/bin/bash -c '${./warden-banner.sh} > /run/warden-motd 2>/dev/null || true'';
              StandardOutput = "null";
            };
          };
        };

        autopilotService = lib.optionalAttrs (cfg.pi.enable && cfg.pi.autopilot.enable) {
          warden-pi-autopilot = {
            description = "Warden Pi autopilot agent";
            after = [ "network.target" "warden-init.service" ];
            wantedBy = [ "multi-user.target" ];
            serviceConfig = let
              wardenSystemPrompt = pkgs.writeText "warden-autopilot-prompt.md" ''
                You are the Warden — an autonomous per-host agent for the host **${config.networking.hostName}**.

                Your responsibilities:
                1. **Monitor**: Run health checks periodically via the warden_run_checks tool.
                2. **Remediate**: When checks fail, diagnose and fix using your tools.
                3. **Report**: Keep the event log updated via warden_tail.
                4. **Backup**: Ensure backups are running via warden_backup.
                5. **Coordinate**: Check peer status via warden_peers and warden_peer_status.

                Keep working until all checks pass and the system is healthy.
                Call the complete tool only when all issues are resolved or you need human input.
              '';
              autopilotCmd = pkgs.writeShellScript "warden-pi-autopilot" ''
                set -euo pipefail
                exec ${pkgs.pi-agent-harness}/bin/pi -p \
                  --no-extensions \
                  -e ${./../../pi-packages/pi-autopilot-complete/extensions/autopilot-complete.ts} \
                  -e ${./../../pi-packages/pi-warden/extensions/warden.ts} \
                  --system-prompt ${wardenSystemPrompt} \
                  --model ${cfg.pi.autopilot.model} \
                  "Run all health checks, remediate any issues, and report status. Then call complete."
              '';
            in {
              Type = "oneshot";
              ExecStart = autopilotCmd;
              User = "calvin";
              Group = "warden";
              TimeoutStartSec = "600";
              MemoryMax = "1G";
              StandardOutput = "journal+console";
              StandardError = "journal";
            };
          };
        };
      in
        checkServices // wardenInit // recordGeneration // wardend
        // backupServices // backupCheckServices // autoRemediateService
        // dashboardServices // dashboardApp // autopilotService;

    # Timers for each check
    systemd.timers =
      let
        checkTimers = lib.mapAttrs' (checkName: checkCfg: {
          name = "warden-check-${sanitizeName checkName}";
          value = {
            description = "Timer for Warden check: ${checkName}";
            wantedBy = [ "timers.target" ];
            timerConfig = {
              OnCalendar = checkCfg.interval;
              Persistent = true;
              RandomizedDelaySec = "60";
            };
          };
        }) enabledChecks;

        backupTimers = lib.optionalAttrs cfg.backups.enable (
          lib.mapAttrs' (repoName: repoCfg: {
            name = "warden-backup-${sanitizeName repoName}";
            value = {
              description = "Timer for Warden backup: ${repoName}";
              wantedBy = [ "timers.target" ];
              timerConfig = {
                OnCalendar = repoCfg.schedule;
                Persistent = true;
                RandomizedDelaySec = "300";
              };
            };
          }) (lib.filterAttrs (n: r: r.enable) cfg.backups.repositories)
        );

        backupCheckTimers = lib.optionalAttrs cfg.backups.enable (
          lib.mapAttrs' (repoName: repoCfg: {
            name = "warden-backup-check-${sanitizeName repoName}";
            value = {
              description = "Weekly integrity check: ${repoName}";
              wantedBy = [ "timers.target" ];
              timerConfig = {
                OnCalendar = "weekly";
                Persistent = true;
                RandomizedDelaySec = "600";
              };
            };
          }) (lib.filterAttrs (n: r: r.enable) cfg.backups.repositories)
        );
        autoRemediateTimer = lib.optionalAttrs cfg.autoRemediate.enable {
          "warden-auto-remediate" = {
            description = "Auto-remediate failing Warden checks";
            wantedBy = [ "timers.target" ];
            timerConfig = {
              OnCalendar = cfg.autoRemediate.interval;
              Persistent = true;
              RandomizedDelaySec = "120";
            };
          };
        };
        autopilotTimer = lib.optionalAttrs (cfg.pi.enable && cfg.pi.autopilot.enable) {
          "warden-pi-autopilot" = {
            description = "Periodic Warden Pi autopilot run";
            wantedBy = [ "timers.target" ];
            timerConfig = {
              OnCalendar = cfg.pi.autopilot.interval;
              Persistent = true;
              RandomizedDelaySec = "60";
            };
          };
        };
      in
        checkTimers // backupTimers // backupCheckTimers // autoRemediateTimer // autopilotTimer;

    # Generate warden config JSON with thresholds + peers + backups
    environment.etc."warden/config.json".source = let
      checksConfig = lib.mapAttrs (name: checkCfg: {
        inherit (checkCfg) thresholds exclude;
      } // checkCfg.extraConfig) enabledChecks;

      peersConfig = lib.mapAttrs (name: peerCfg: {
        inherit (peerCfg) host port;
      }) (lib.filterAttrs (name: peerCfg: peerCfg.enabled) cfg.peers);

      backupsConfig = lib.optionalAttrs cfg.backups.enable {
        tool = cfg.backups.tool;
        preHook = cfg.backups.preHook;
        postHook = cfg.backups.postHook;
        repositories = lib.mapAttrs (name: repo: {
          inherit (repo) type path host passwordFile schedule timeout paths exclude;
          retention = repo.retention;
        }) (lib.filterAttrs (n: r: r.enable) cfg.backups.repositories);
      };

      allConfig = {
        checks = checksConfig;
        peers = peersConfig;
      } // (if cfg.backups.enable then { backups = backupsConfig; } else {});
    in
      pkgs.writeText "warden-config.json" (builtins.toJSON allConfig);

    # ── Login banner ───────────────────────────────────────────

    environment.etc."warden/banner.sh".source = ./warden-banner.sh;

    # wardenctl + restic (if backups) + banner script + pi (if autopilot)
    environment.systemPackages = [ wardenctl ]
      ++ lib.optionals cfg.backups.enable [ pkgs.restic ]
      ++ [ (pkgs.writeShellScriptBin "warden-banner" ''
        exec ${pkgs.bash}/bin/bash ${./warden-banner.sh}
      '') ]
      ++ lib.optionals (cfg.pi.enable && cfg.pi.autopilot.enable) [ pkgs.pi-agent-harness ]
      ++ lib.optionals cfg.dashboard.enable [ pkgs.python3Packages.flask ];

  };
}

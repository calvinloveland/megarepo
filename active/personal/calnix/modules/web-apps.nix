# NixOS module: Megarepo web apps as systemd services

{ config, pkgs, lib, ... }:

let
  repoRoot = "/home/calvin/megarepo";
  dataRoot = "/data/megarepo-apps";

  apps = {
    momos = { port = 5101; module = "momos.app"; workDir = "${repoRoot}/active/web-apps/momos"; description = "Family command center"; srcDirs = [ "${repoRoot}/active/web-apps/momos/src" ]; };
    parambulator = { port = 5102; module = "parambulator.app"; workDir = "${repoRoot}/active/web-apps/parambulator"; description = "Seating chart planner"; srcDirs = [ "${repoRoot}/active/web-apps/parambulator/src" ]; };
    sub-day-generator = { port = 5103; module = "sub_day_generator.app"; workDir = "${repoRoot}/active/web-apps/sub-day-generator"; description = "Substitute teacher plans"; srcDirs = [ "${repoRoot}/active/web-apps/sub-day-generator/src" ]; };
    holdem = { port = 5104; module = "holdem_together.app"; workDir = "${repoRoot}/active/games/lets-holdem-together"; description = "Multiplayer poker"; srcDirs = [ ]; };
    code-reviewdle = { port = 5105; module = "code_reviewdle.app"; workDir = "${repoRoot}/active/games/code_reviewdle"; description = "Code review puzzle"; srcDirs = [ "${repoRoot}/active/games/code_reviewdle/src" ]; };
    conway = { port = 5106; module = "conways_game_of_war.main"; workDir = "${repoRoot}/active/games/conway_game_of_war"; description = "Conway's Game of War"; srcDirs = [ "${repoRoot}/active/games/conway_game_of_war/src" ]; };
    tcg = { port = 5107; module = "super_ultimate_trading_card_game.web"; workDir = "${repoRoot}/active/games/super_ultimate_trading_card_game"; description = "Trading card game"; srcDirs = [ "${repoRoot}/active/games/super_ultimate_trading_card_game/src" ]; };
    ops = { port = 5109; module = "operationalize"; workDir = "${repoRoot}/active/dev-tools/operationalize"; description = "Project management"; srcDirs = [ "${repoRoot}/active/dev-tools/operationalize/src" ]; };
  };

  mkService = name: appCfg: appDef: let
    pythonPath = lib.concatStringsSep ":" appDef.srcDirs;
  in lib.optionalAttrs appCfg.enable {
    "webapp-${name}" = {
      description = "Megarepo — ${appDef.description}";
      after = [ "network.target" ];
      wantedBy = [ "multi-user.target" ];
      environment = {
        FLASK_DEBUG = "false";
        FLASK_ENV = "development";
        PYTHONUNBUFFERED = "1";
        SECRET_KEY = "dev-key-${name}";
        PORT = builtins.toString appDef.port;
        HOST = "127.0.0.1";
      } // lib.optionalAttrs (pythonPath != "") { PYTHONPATH = pythonPath; };
      serviceConfig = {
        Type = "simple";
        User = "calvin";
        Group = "users";
        WorkingDirectory = appDef.workDir;
        ExecStart = "${pkgs.nix}/bin/nix-shell ${repoRoot}/active/web-apps/launcher/shell.nix --run 'python -m ${appDef.module}'";
        Restart = "on-failure";
        RestartSec = "5s";
        StandardOutput = "journal";
        StandardError = "journal";
        PrivateTmp = true;
        NoNewPrivileges = true;
      };
    };
  };

  mkTunnel = name: appCfg: appDef: lib.optionalAttrs (appCfg.enable && appCfg.tunnel) {
    "cloudflared-${name}" = {
      description = "Cloudflare Tunnel — ${appDef.description}";
      after = [ "network.target" "webapp-${name}.service" ];
      wants = [ "webapp-${name}.service" ];
      wantedBy = [ "multi-user.target" ];
      serviceConfig = {
        Type = "simple";
        User = "calvin";
        Group = "users";
        ExecStart = "${pkgs.cloudflared}/bin/cloudflared tunnel --url http://127.0.0.1:${builtins.toString appDef.port}";
        Restart = "on-failure";
        RestartSec = "5s";
        StandardOutput = "journal";
        StandardError = "journal";
      };
    };
  };

in {
  options.calnix.webApps = lib.mkOption {
    description = "Megarepo web app services";
    default = { };
    type = lib.types.attrsOf (lib.types.submodule {
      options = {
        enable = lib.mkEnableOption "Run this web app";
        tunnel = lib.mkEnableOption "Create a Cloudflare Tunnel" // { default = false; };
      };
    });
  };

  config = let
    activeApps = lib.filterAttrs (n: v: v.enable) config.calnix.webApps;
    hasTunnels = builtins.any (v: v.tunnel) (builtins.attrValues activeApps);
  in {
    systemd.tmpfiles.rules = [
      "d ${dataRoot} 0775 calvin users - -"
      "d ${dataRoot}/parambulator 0775 calvin users - -"
      "d ${dataRoot}/code-reviewdle 0775 calvin users - -"
      "d ${dataRoot}/tcg 0775 calvin users - -"
      "d ${dataRoot}/ops 0775 calvin users - -"
    ];
    environment.systemPackages = lib.optionals hasTunnels [ pkgs.cloudflared ];
    systemd.services = lib.mkMerge (
      lib.mapAttrsToList (name: appCfg:
        mkService name appCfg (builtins.getAttr name apps)
      ) activeApps
    ) // lib.mkMerge (
      lib.mapAttrsToList (name: appCfg:
        mkTunnel name appCfg (builtins.getAttr name apps)
      ) activeApps
    );
  };
}

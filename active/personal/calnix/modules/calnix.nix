{
  config,
  pkgs,
  lib,
  ...
}:
let
  cfg = config.calnix;

  calnixCliSource = pkgs.runCommand "calnix-cli-source" { } ''
    mkdir -p "$out"
    cp ${../calnix_cli.py} "$out/calnix_cli.py"
    cp ${../calnix_state.py} "$out/calnix_state.py"
    cp ${../rebuild.py} "$out/rebuild.py"
    cp ${../package-health-registry.json} "$out/package-health-registry.json"
  '';

  calnixCli = pkgs.writeShellApplication {
    name = "calnix";
    runtimeInputs = [
      pkgs.git
      pkgs.nix
      pkgs.python3
    ];
    text = ''
      export CALNIX_STATE_DIR=${cfg.stateDir}
      export CALNIX_REGISTRY_FILE=${calnixCliSource}/package-health-registry.json
      export CALNIX_REBUILD_SCRIPT=${calnixCliSource}/rebuild.py
      exec ${pkgs.python3}/bin/python3 ${calnixCliSource}/calnix_cli.py "$@"
    '';
  };
in
{
  options.calnix.stateDir = lib.mkOption {
    type = lib.types.str;
    default = "/var/lib/calnix";
    description = "Machine-local calnix state directory for package health and generation metadata.";
  };

  config = {
    users.groups.calnix = { };
    users.users.calvin.extraGroups = [ "calnix" ];

    systemd.tmpfiles.rules = [
      "d ${cfg.stateDir} 2775 root calnix - -"
      "d ${cfg.stateDir}/generations 2775 root calnix - -"
    ];

    environment.systemPackages = [ calnixCli ];
  };
}

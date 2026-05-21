{
  config,
  pkgs,
  lib,
  ...
}:
let
  cfg = config.calnix.bootstrap.ssh;
  inherit (lib) mkIf mkEnableOption mkOption types;
in
{
  options.calnix.bootstrap.ssh = {
    enable = mkEnableOption "bootstrap live-image SSH access";

    controllerPubkey = mkOption {
      type = types.nullOr types.str;
      default = null;
      description = "Public SSH key of the controller machine. Injected into bootstrap user's authorized_keys.";
    };

    additionalAuthorizedKeys = mkOption {
      type = types.listOf types.str;
      default = [ ];
      description = "Additional SSH public keys authorized for the bootstrap user.";
    };

    bootstrapUserName = mkOption {
      type = types.str;
      default = "bootstrap";
      description = "Temporary user created for the live image.";
    };
  };

  config = mkIf cfg.enable {
    services.openssh = {
      enable = true;
      openFirewall = true; # Allow SSH on port 22 during bootstrap
      settings = {
        PermitRootLogin = "no";
        PasswordAuthentication = false;
        KbdInteractiveAuthentication = false;
        PubkeyAuthentication = true;
        X11Forwarding = false;
        UseDns = false;
        # AcceptEnv needed for controller to pass facts through SSH
        AcceptEnv = [ "FACTER_*" ];
      };
      hostKeys = [
        {
          path = "/etc/ssh/ssh_host_ed25519_key";
          type = "ed25519";
        }
      ];
    };

    # Create dedicated bootstrap user
    users.users.${cfg.bootstrapUserName} = {
      isNormalUser = true;
      description = "Bootstrap live-image temporary user";
      initialHashedPassword = null; # No password — key-only
      openssh.authorizedKeys.keys =
        (lib.optional (cfg.controllerPubkey != null) cfg.controllerPubkey)
        ++ cfg.additionalAuthorizedKeys;
      extraGroups = [ "wheel" "networkmanager" ];
    };

    # Allow bootstrap user to sudo without password for install commands
    security.sudo.extraRules = [
      {
        users = [ cfg.bootstrapUserName ];
        commands = [
          {
            command = "ALL";
            options = [ "NOPASSWD" ];
          }
        ];
      }
    ];
  };
}

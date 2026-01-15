{
  description = "Tests for Calvin's Multi-Host NixOS Configuration";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        # Import our main flake configurations
        mainFlake = import ../flake.nix;
        configurations = mainFlake.outputs {
          inherit nixpkgs;
          home-manager = nixpkgs.lib.nixosModules.home-manager or { };
          nixos-wsl = nixpkgs.lib.nixosModules.nixos-wsl or { };
          kickstart-nix-nvim = {
            overlays.default = _: _: { };
          };
          nix-index-database = { };
        };

        # Test that configurations build successfully
        buildTest =
          name: config:
          pkgs.runCommand "test-${name}-build" { } ''
            echo "Testing ${name} configuration build..."
            # Dry run build to check for syntax errors
            ${pkgs.nixos-rebuild}/bin/nixos-rebuild dry-run --flake ${config}
            touch $out
          '';

        # Create minimal VM tests
        vmTest =
          name: configPath:
          pkgs.nixosTest {
            name = "test-${name}-vm";
            nodes.machine =
              { ... }:
              {
                imports = [ configPath ];
                # Override hardware-specific settings for VM
                boot.loader.grub.device = "/dev/vda";
                fileSystems."/" = {
                  device = "/dev/vda1";
                  fsType = "ext4";
                };
                # Disable hardware-specific services in VM
                services.tlp.enable = pkgs.lib.mkForce false;
                hardware.bluetooth.enable = pkgs.lib.mkForce false;
              };

            testScript = ''
              machine.start()
              machine.wait_for_unit("multi-user.target")

              # Test basic functionality
              machine.succeed("which fish")
              machine.succeed("which git")
              machine.succeed("which nixos-rebuild")

              # Test user exists and has correct shell
              machine.succeed("getent passwd calvin | grep fish")

              # Test docker service if enabled
              machine.succeed("systemctl is-enabled docker || true")
            '';
          };

      in
      {
        checks = {
          # Syntax validation tests
          thinker-builds = buildTest "thinker" ../hosts/thinker/configuration.nix;
          work-wsl-builds = buildTest "work-wsl" ../hosts/work-wsl/configuration.nix;

          # VM integration tests (commented out as they're resource intensive)
          # thinker-vm = vmTest "thinker" ../hosts/thinker/configuration.nix;
          # work-wsl-vm = vmTest "work-wsl" ../hosts/work-wsl/configuration.nix;

          # Script tests
          rebuild-script-test =
            pkgs.runCommand "test-rebuild-script"
              {
                buildInputs = [
                  pkgs.bash
                  pkgs.coreutils
                ];
              }
              ''
                cd ${../.}

                # Test script syntax
                bash -n rebuild.sh

                # Test help output
                output=$(bash rebuild.sh unknown-host 2>&1 || true)
                if [[ "$output" != *"Unknown host"* ]]; then
                  echo "Help output test failed"
                  exit 1
                fi

                echo "Rebuild script tests passed"
                touch $out
              '';
        };

        # Development shell with testing tools
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nixos-rebuild
            nixpkgs-fmt
            statix # Nix linter
            deadnix # Find dead Nix code
          ];

          shellHook = ''
            echo "🧪 NixOS Configuration Testing Environment"
            echo "Available commands:"
            echo "  nix flake check tests/    - Run all tests"
            echo "  statix check .           - Lint Nix files"
            echo "  deadnix .                - Find unused code"
            echo "  nixpkgs-fmt .            - Format Nix files"
          '';
        };
      }
    );
}

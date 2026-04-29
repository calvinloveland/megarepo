{
  description = "Calvin's Multi-Host NixOS Configuration";
  inputs = {
    kickstart-nix-nvim = {
      url = "github:nix-community/kickstart-nix.nvim";
    };
    # User's nixpkgs - for user packages
    nixpkgs = {
      url = "github:nixos/nixpkgs/nixos-unstable";
    };
    nix-index-database = {
      url = "github:nix-community/nix-index-database";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nixos-hardware = {
      url = "github:NixOS/nixos-hardware";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      home-manager,
      kickstart-nix-nvim,
      nixos-hardware,
      ...
    }@inputs:
    let
      lib = nixpkgs.lib;

      packageHealthRegistry = builtins.fromJSON (builtins.readFile ./package-health-registry.json);

      calnixState =
        let
          stateFile = builtins.getEnv "CALNIX_STATE_FILE";
        in
        if stateFile != "" && builtins.pathExists stateFile then
          builtins.fromJSON (builtins.readFile stateFile)
        else
          {
            packages = { };
          };

      currentNixpkgsRev =
        if nixpkgs ? rev then
          nixpkgs.rev
        else if nixpkgs ? sourceInfo && nixpkgs.sourceInfo ? rev then
          nixpkgs.sourceInfo.rev
        else
          null;

      importPackageSetForRevision =
        system: revision:
        import (builtins.getFlake "github:NixOS/nixpkgs/${revision}").outPath {
          inherit system;
          config.allowUnfree = true;
        };

      packageHealth = {
        inherit
          calnixState
          currentNixpkgsRev
          importPackageSetForRevision
          packageHealthRegistry
          ;
      };

      githubCopilotCliVersion = "1.0.26";
      githubCopilotCliSources = {
        x86_64-linux = {
          name = "copilot-linux-x64";
          hash = "sha256-i77fn0DOW/VjCzXY4mQbmtADQ2pFsju4zPM9iZNmmG8=";
        };
      };
      piAgentHarnessVersion = "0.70.6";
      piAgentHarnessSrcHash = "sha256-6ycYjAKqPbXkyzyGL+ZaJKfZGmZEDJxNA3WuGoK43qc=";
      piAgentHarnessNpmDepsHash = "sha256-mEnM4xYMQDn2Xk5joOyacoLVVoKpHoBdAvLKtFcFRI4=";

      # Track github-copilot-cli ahead of nixpkgs while nixos-unstable lags.
      # Preserve the binary filename as "copilot" because the CLI
      # self-references that exact name internally.
      githubCopilotCliOverlay = final: prev:
        let
          srcConfig =
            githubCopilotCliSources.${prev.stdenv.hostPlatform.system}
              or (throw "Unsupported github-copilot-cli system: ${prev.stdenv.hostPlatform.system}");
        in
        {
          github-copilot-cli = prev.github-copilot-cli.overrideAttrs (oldAttrs: {
            version = githubCopilotCliVersion;
            src = prev.fetchurl {
              url = "https://github.com/github/copilot-cli/releases/download/v${githubCopilotCliVersion}/${srcConfig.name}.tar.gz";
              inherit (srcConfig) hash;
            };
            installPhase = ''
              runHook preInstall
              install -Dm755 copilot $out/libexec/copilot
              runHook postInstall
            '';
            postInstall = ''
              makeBinaryWrapper $out/libexec/copilot $out/bin/copilot \
                --add-flags "--no-auto-update"
            '';
            meta = oldAttrs.meta // {
              changelog = "https://github.com/github/copilot-cli/releases/tag/v${githubCopilotCliVersion}";
            };
          });
        };

      piAgentHarnessOverlay = final: prev: {
        pi-agent-harness = prev.buildNpmPackage {
          pname = "pi-agent-harness";
          version = piAgentHarnessVersion;
          src = prev.fetchurl {
            url = "https://registry.npmjs.org/@mariozechner/pi-coding-agent/-/pi-coding-agent-${piAgentHarnessVersion}.tgz";
            hash = piAgentHarnessSrcHash;
          };
          postPatch = ''
            cp ${./pi-agent-harness-package-lock.json} package-lock.json
          '';
          npmDepsHash = piAgentHarnessNpmDepsHash;
          dontNpmBuild = true;
          meta = with prev.lib; {
            description = "Pi coding agent CLI";
            homepage = "https://github.com/badlogic/pi-mono";
            license = licenses.mit;
            mainProgram = "pi";
            platforms = platforms.linux;
          };
        };
      };

      supportedSystems = [ "x86_64-linux" ];

      openvinoUrl = "https://storage.openvinotoolkit.org/repositories/openvino/packages/2024.6/linux/l_openvino_toolkit_ubuntu22_2024.6.0.17404.4c0f47d2335_x86_64.tgz";
      openvinoSha256 = "1h1rmdk9614ni1zi2671icq6d50gpa41cg6wqwly7zwq5v9xkng6";

      mkPkgs = system: import nixpkgs {
        inherit system;
        config.allowUnfree = true;
      };

      openvinoContexts = lib.genAttrs supportedSystems (system:
        let
          pkgsFor = mkPkgs system;
          openvinoSrc = pkgsFor.fetchurl {
            url = openvinoUrl;
            sha256 = openvinoSha256;
          };
          openvinoRuntime = pkgsFor.runCommand "openvino-2024.6-runtime" {
            nativeBuildInputs = [
              pkgsFor.gnutar
              pkgsFor.gzip
            ];
          } ''
            mkdir -p $out
            tar --strip-components=1 -xzf ${openvinoSrc} -C $out
          '';
          levelZero = pkgsFor.level-zero;
        in
        {
          inherit pkgsFor openvinoRuntime levelZero;
          openvinoLibDir = "${openvinoRuntime}/runtime/lib/intel64";
          openvinoPkgConfigDir = "${openvinoRuntime}/runtime/lib/pkgconfig";
          openvinoPythonDir = "${openvinoRuntime}/python";
          openvinoTbbDir = "${openvinoRuntime}/runtime/3rdparty/tbb/lib";
          openvinoHddlDir = "${openvinoRuntime}/runtime/3rdparty/hddl/lib";
          levelZeroLibDir = "${levelZero}/lib";
          toolchainLibDir = "${pkgsFor.stdenv.cc.cc.lib}/lib";
        }
      );

      devShells = lib.genAttrs supportedSystems (
        system:
        let
          openvinoCtx = openvinoContexts.${system};
          pkgsForDevShell = openvinoCtx.pkgsFor;
        in
        {
          default = pkgsForDevShell.mkShell {
            name = "calnix-openvino";
            packages = with pkgsForDevShell; [
              python312
              python312Packages.pip
              python312Packages.setuptools
              python312Packages.numpy
              git
              cmake
              pkg-config
            ] ++ [ openvinoCtx.levelZero ];

            shellHook = ''
              set -euo pipefail

              _calnix_prepend_path() {
                local var="$1"
                local value="$2"
                if [ ! -d "$value" ] && [ ! -f "$value" ]; then
                  return 0
                fi
                local current="''${!var:-}"
                case ":$current:" in
                  *":$value:"*) return 0 ;;
                esac
                if [ -n "$current" ]; then
                  eval export "$var=$value:$current"
                else
                  eval export "$var=$value"
                fi
              }

              export INTEL_OPENVINO_DIR=${openvinoCtx.openvinoRuntime}
              export OpenVINO_DIR="$INTEL_OPENVINO_DIR"
              export OpenVINO_VERSION="2024.6"
              export IE_PLUGINS_PATH=${openvinoCtx.openvinoLibDir}
              export INTEL_NPU_DEVICE="''${INTEL_NPU_DEVICE:-NPU}"

              _calnix_prepend_path LD_LIBRARY_PATH ${openvinoCtx.openvinoLibDir}
              _calnix_prepend_path LD_LIBRARY_PATH ${openvinoCtx.openvinoTbbDir}
              _calnix_prepend_path LD_LIBRARY_PATH ${openvinoCtx.openvinoHddlDir}
              _calnix_prepend_path LD_LIBRARY_PATH ${openvinoCtx.levelZeroLibDir}
              _calnix_prepend_path LD_LIBRARY_PATH ${openvinoCtx.toolchainLibDir}
              _calnix_prepend_path LD_LIBRARY_PATH /usr/local/lib64
              _calnix_prepend_path LD_LIBRARY_PATH /usr/local/lib
              _calnix_prepend_path PKG_CONFIG_PATH ${openvinoCtx.openvinoPkgConfigDir}
              _calnix_prepend_path PYTHONPATH ${openvinoCtx.openvinoPythonDir}

              export INTEL_NPU_HOME="$HOME/.intel_npu"
              mkdir -p "$INTEL_NPU_HOME"
              ln -sfn ${openvinoCtx.openvinoLibDir} "$INTEL_NPU_HOME/lib"
              ln -sfn ${openvinoCtx.openvinoRuntime}/runtime/share "$INTEL_NPU_HOME/share"

              if [ -z "''${CALNIX_SKIP_NPU_CHECK:-}" ]; then
                python3 - <<'PY'
import sys
try:
    from openvino.runtime import Core
except Exception as exc:  # pragma: no cover - diagnostic path
    print(f"[calnix:npu] Unable to import openvino.runtime: {exc}", file=sys.stderr)
    sys.exit(1)

try:
    core = Core()
    devices = core.available_devices
except Exception as exc:  # pragma: no cover - diagnostic path
    print(f"[calnix:npu] OpenVINO runtime check failed: {exc}", file=sys.stderr)
    sys.exit(1)

print(f"[calnix:npu] Detected devices: {devices}")
if "NPU" not in devices:
    print("[calnix:npu] Intel NPU not reported by OpenVINO. Export CALNIX_SKIP_NPU_CHECK=1 to bypass.", file=sys.stderr)
    sys.exit(1)
PY
              fi

              echo "[calnix] OpenVINO 2024.6 environment ready (INTEL_NPU_DEVICE=$INTEL_NPU_DEVICE)"
            '';
          };
        }
      );

      commonOverlays = [
        kickstart-nix-nvim.overlays.default
        githubCopilotCliOverlay
        piAgentHarnessOverlay
      ];
    in
    {
      inherit devShells;
      packages = lib.genAttrs supportedSystems (system: {
        openvino-runtime = openvinoContexts.${system}.openvinoRuntime;
      });

      nixosConfigurations = {
        # ThinkPad configuration with gaming
        thinker = nixpkgs.lib.nixosSystem {
          system = "x86_64-linux";
          specialArgs = {
            inherit inputs packageHealth;
          };
          modules = [
            {
              nixpkgs.overlays = commonOverlays;
            }
            home-manager.nixosModules.home-manager
            ./hosts/thinker/configuration.nix
          ];
        };

        # HP Elitebook configuration with gaming
        "1337book" = nixpkgs.lib.nixosSystem {
          system = "x86_64-linux";
          specialArgs = {
            inherit inputs packageHealth;
          };
          modules = [
            {
              nixpkgs.overlays = commonOverlays;
            }
            home-manager.nixosModules.home-manager
            # Add Intel Lunar Lake CPU and GPU support
            (import "${nixos-hardware}/common/cpu/intel/lunar-lake")
            ./hosts/1337book/configuration.nix
          ];
        };

        # Legacy configuration names for backward compatibility
        nixos = nixpkgs.lib.nixosSystem {
          system = "x86_64-linux";
          specialArgs = {
            inherit inputs packageHealth;
          };
          modules = [
            {
              nixpkgs.overlays = commonOverlays;
            }
            home-manager.nixosModules.home-manager
            ./hosts/thinker/configuration.nix
          ];
        };

        Thinker = nixpkgs.lib.nixosSystem {
          system = "x86_64-linux";
          specialArgs = {
            inherit inputs packageHealth;
          };
          modules = [
            {
              nixpkgs.overlays = commonOverlays;
            }
            home-manager.nixosModules.home-manager
            ./hosts/thinker/configuration.nix
          ];
        };
      };
    };
}

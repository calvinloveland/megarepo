#!/usr/bin/env python3

"""
Configuration validation tests for Calvin's NixOS setup.
Checks for common configuration issues and validates module structure.
"""

import os
import sys
import json
import subprocess
from pathlib import Path
from typing import List, Dict, Any

class ConfigValidator:
    def __init__(self, root_path: str = None):
        # Auto-detect the calnix directory
        if root_path is None:
            current_dir = Path(__file__).parent.resolve()
            # Look for calnix directory from tests directory
            if current_dir.name == "tests":
                self.root = current_dir.parent
            else:
                # Try to find calnix directory
                calnix_path = Path.cwd() / "calnix"
                if calnix_path.exists():
                    self.root = calnix_path
                else:
                    self.root = Path.cwd()
        else:
            self.root = Path(root_path).resolve()
            
        self.errors = []
        self.warnings = []
        hosts_dir = self.root / "hosts"
        if hosts_dir.exists():
            self.hosts = sorted(
                [path.name for path in hosts_dir.iterdir() if path.is_dir()]
            )
        else:
            self.hosts = []
            self.warning("hosts directory not found; no host configurations detected")
        print(f"🔍 Validating configuration in: {self.root}")
        
    def error(self, msg: str):
        self.errors.append(f"❌ ERROR: {msg}")
        
    def warning(self, msg: str):
        self.warnings.append(f"⚠️  WARNING: {msg}")
        
    def success(self, msg: str):
        print(f"✅ {msg}")

    def validate_file_structure(self):
        """Validate expected file structure exists."""
        required_files = [
            "flake.nix",
            "rebuild.sh",
            "rebuild.py",
            "calnix_cli.py",
            "calnix_state.py",
            "package-health-registry.json",
            "modules/base.nix",
            "modules/calnix.nix",
            "modules/desktop.nix",
            "modules/desktop-scripts.nix",
            "modules/gaming.nix",
            "homely-man.nix",
            "python-dev.nix"
        ]
        
        for file_path in required_files:
            full_path = self.root / file_path
            if not full_path.exists():
                self.error(f"Missing required file: {file_path}")
            else:
                self.success(f"Found {file_path}")

        if not self.hosts:
            self.warning("No host configurations declared under hosts/ (skipping host-specific checks)")
        else:
            for host in self.hosts:
                config_file = self.root / f"hosts/{host}/configuration.nix"
                if not config_file.exists():
                    self.error(f"Missing required file: hosts/{host}/configuration.nix")
                else:
                    self.success(f"Found hosts/{host}/configuration.nix")

    def validate_nix_syntax(self):
        """Check Nix syntax for all .nix files in the project directory only."""
        # Only check .nix files in the project directory, not the entire home dir
        nix_files = []
        for pattern in ["*.nix", "**/*.nix"]:
            nix_files.extend(self.root.glob(pattern))
        
        # Filter to only files within our project
        project_files = [f for f in nix_files if self.root in f.parents or f.parent == self.root]
        
        for nix_file in project_files:
            try:
                # Use nix-instantiate to check syntax
                result = subprocess.run(
                    ["nix-instantiate", "--parse", str(nix_file)],
                    capture_output=True,
                    text=True,
                    cwd=self.root
                )
                if result.returncode != 0:
                    self.error(f"Syntax error in {nix_file.relative_to(self.root)}: {result.stderr}")
                else:
                    self.success(f"Valid syntax: {nix_file.relative_to(self.root)}")
            except FileNotFoundError:
                self.warning("nix-instantiate not found, skipping syntax validation")
                break

    def validate_flake_outputs(self):
        """Validate flake outputs are correctly defined."""
        try:
            result = subprocess.run(
                ["nix", "flake", "show", "--json", f"path:{self.root}"],
                capture_output=True,
                text=True,
                cwd=self.root
            )
            
            if result.returncode != 0:
                self.error(f"Flake validation failed: {result.stderr}")
                return
                
            outputs = json.loads(result.stdout)
            
            nixos_configs = outputs.get("nixosConfigurations", {})

            if not self.hosts:
                self.warning("No host folders detected; skipping nixosConfiguration checks")
            else:
                for host in self.hosts:
                    if host in nixos_configs:
                        self.success(f"Found nixosConfiguration: {host}")
                    else:
                        self.error(f"Missing nixosConfiguration: {host}")
                    
        except (subprocess.SubprocessError, json.JSONDecodeError, FileNotFoundError) as e:
            if isinstance(e, FileNotFoundError):
                self.warning("nix not found, skipping flake output validation")
            else:
                self.error(f"Failed to validate flake outputs: {e}")

    def validate_common_imports(self):
        """Check that all hosts import base configuration."""
        for host in self.hosts:
            config_path = f"hosts/{host}/configuration.nix"
            config = self.root / config_path
            if config.exists():
                content = config.read_text()
                if "../../modules/base.nix" in content:
                    self.success(f"{config_path} imports base module")
                else:
                    self.error(f"{config_path} missing base module import")
            else:
                self.error(f"{config_path} missing for base module validation")

    def validate_rebuild_script(self):
        """Check rebuild script functionality."""
        script = self.root / "rebuild.sh"
        if not script.exists():
            self.error("rebuild.sh not found")
            return

        # Check if script is executable
        if not os.access(script, os.X_OK):
            self.warning("rebuild.sh is not executable")

        content = script.read_text()
        if "rebuild.py" in content:
            self.success("rebuild.sh delegates to rebuild.py")
        else:
            self.error("rebuild.sh should delegate to rebuild.py")

        rebuild_py = self.root / "rebuild.py"
        if rebuild_py.exists():
            self.success("rebuild.py exists")
        else:
            self.error("rebuild.py not found")

    def validate_copilot_overlay(self):
        """Check that github-copilot-cli overlay and home-manager global pkgs are configured.

        Calnix tracks an explicit GitHub Copilot CLI release when nixpkgs lags
        upstream, while still preserving the executable filename as exactly
        'copilot' for internal self-referencing. The overlay uses a libexec
        wrapper so the binary keeps that name.

        home-manager.useGlobalPkgs = true ensures the overlay also applies to
        user packages installed via home-manager (otherwise home-manager
        instantiates its own pkgs without the overlay).
        """
        flake_nix = self.root / "flake.nix"
        if not flake_nix.exists():
            self.error("flake.nix not found; cannot validate copilot overlay")
            return

        flake_content = flake_nix.read_text()

        if "githubCopilotCliOverlay" in flake_content:
            self.success("flake.nix defines githubCopilotCliOverlay for Copilot CLI pinning")
        else:
            self.error("flake.nix missing githubCopilotCliOverlay")

        if (
            "githubCopilotCliVersion =" in flake_content
            and "version = githubCopilotCliVersion;" in flake_content
            and "releases/download/v${githubCopilotCliVersion}" in flake_content
        ):
            self.success("copilot overlay pins an explicit upstream GitHub release")
        else:
            self.error("copilot overlay should pin github-copilot-cli to an explicit release")

        if "makeBinaryWrapper" in flake_content and "libexec" in flake_content:
            self.success("copilot overlay uses makeBinaryWrapper via libexec (preserves binary name)")
        else:
            self.error(
                "copilot overlay should use makeBinaryWrapper + libexec to preserve 'copilot' filename"
            )

        # Verify --no-warnings is NOT injected by the overlay (fixes nixpkgs #500198).
        # The overlay must not add --no-warnings because newer Node.js removed that flag.
        overlay_start = flake_content.find("githubCopilotCliOverlay = final: prev:")
        overlay_end = flake_content.find("};", overlay_start) + 2 if overlay_start != -1 else -1
        if overlay_start != -1 and overlay_end > overlay_start:
            overlay_text = flake_content[overlay_start:overlay_end]
            if "--no-warnings" in overlay_text:
                self.error(
                    "copilot overlay must NOT pass --no-warnings (removed in newer Node.js, "
                    "see nixpkgs issue #500198)"
                )
            else:
                self.success("copilot overlay does not inject --no-warnings (correct)")

        # Verify the fixed copilot package is exposed as a flake output for buildability testing.
        if "github-copilot-cli = pkgs.github-copilot-cli" in flake_content:
            self.success("flake.nix exposes github-copilot-cli as a testable package output")
        else:
            self.warning(
                "flake.nix does not expose github-copilot-cli as a package output; "
                "add it so the fix can be verified with: nix build .#packages.x86_64-linux.github-copilot-cli"
            )

        # Check that the overlay is both defined and applied in nixosConfigurations.
        # The definition is "githubCopilotCliOverlay = final: prev:" and the
        # application is inside a nixpkgs.overlays list.
        overlay_defined = "githubCopilotCliOverlay = final: prev:" in flake_content
        overlay_applied = "githubCopilotCliOverlay" in flake_content and (
            "overlays" in flake_content
        )
        if overlay_defined and overlay_applied:
            self.success("githubCopilotCliOverlay is defined and applied in nixosConfigurations")
        elif not overlay_defined:
            self.error("githubCopilotCliOverlay definition not found in flake.nix")
        else:
            self.error("githubCopilotCliOverlay must be applied in nixosConfigurations overlays list")

        # Verify home-manager uses global pkgs so the overlay reaches user packages
        base_nix = self.root / "modules" / "base.nix"
        if base_nix.exists():
            base_content = base_nix.read_text()
            if "home-manager.useGlobalPkgs = true" in base_content:
                self.success("modules/base.nix sets home-manager.useGlobalPkgs = true")
            else:
                self.error(
                    "modules/base.nix must set home-manager.useGlobalPkgs = true so the "
                    "githubCopilotCliOverlay is applied to home-manager packages"
                )
        else:
            self.warning("modules/base.nix not found; cannot verify home-manager.useGlobalPkgs")

        # Ensure home/base.nix does not redundantly override nixpkgs.config
        home_base = self.root / "home" / "base.nix"
        if home_base.exists():
            home_content = home_base.read_text()
            if "nixpkgs.config.allowUnfree" in home_content:
                self.warning(
                    "home/base.nix sets nixpkgs.config.allowUnfree, which is ignored when "
                    "home-manager.useGlobalPkgs = true; consider removing it"
                )
            else:
                self.success("home/base.nix does not redundantly set nixpkgs.config (correct with useGlobalPkgs)")

    def run_all_validations(self):
        """Run all validation checks."""
        print("🔍 Starting configuration validation...\n")
        
        self.validate_file_structure()
        print()
        
        self.validate_nix_syntax()
        print()
        
        self.validate_flake_outputs()
        print()
        
        self.validate_common_imports()
        print()
        
        self.validate_rebuild_script()
        print()

        self.validate_copilot_overlay()
        print()

        # Summary
        print("📊 Validation Summary:")
        print(f"Errors: {len(self.errors)}")
        print(f"Warnings: {len(self.warnings)}")
        
        if self.errors:
            print("\n🚨 Errors found:")
            for error in self.errors:
                print(f"  {error}")
                
        if self.warnings:
            print("\n⚠️  Warnings:")
            for warning in self.warnings:
                print(f"  {warning}")
                
        if not self.errors and not self.warnings:
            print("\n🎉 All validations passed!")
            return 0
        elif not self.errors:
            print("\n✅ No errors found (warnings only)")
            return 0
        else:
            print(f"\n💥 Found {len(self.errors)} errors")
            return 1

if __name__ == "__main__":
    validator = ConfigValidator()
    sys.exit(validator.run_all_validations())

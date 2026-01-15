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
            "modules/base.nix",
            "modules/desktop.nix",
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
                ["nix", "flake", "show", "--json"],
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
                    
        except (subprocess.SubprocessError, json.JSONDecodeError) as e:
            self.error(f"Failed to validate flake outputs: {e}")

    def validate_gaming_separation(self):
        """Ensure gaming packages are properly separated."""
        gaming_packages = [
            "steam", "blender", "krita", "aseprite", 
            "dwarf-fortress", "flatpak"
        ]
        
        # Check that work-wsl doesn't include gaming packages
        work_config = self.root / "hosts/work-wsl/configuration.nix"
        if "work-wsl" in self.hosts and work_config.exists():
            content = work_config.read_text()
            for package in gaming_packages:
                if package in content:
                    self.warning(f"Gaming package '{package}' found in work-wsl config")
            
            if "gaming.nix" in content:
                self.error("work-wsl config imports gaming.nix - this defeats the purpose!")
            else:
                self.success("work-wsl properly excludes gaming module")
        elif "work-wsl" in self.hosts:
            self.error("Expected work-wsl configuration file is missing during gaming separation check")

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
            
        # Check for required functions
        content = script.read_text()
        if "detect_host()" in content:
            self.success("rebuild.sh has detect_host function")
        else:
            self.error("rebuild.sh missing detect_host function")

    def run_all_validations(self):
        """Run all validation checks."""
        print("🔍 Starting configuration validation...\n")
        
        self.validate_file_structure()
        print()
        
        self.validate_nix_syntax()
        print()
        
        self.validate_flake_outputs()
        print()
        
        self.validate_gaming_separation()
        print()
        
        self.validate_common_imports()
        print()
        
        self.validate_rebuild_script()
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
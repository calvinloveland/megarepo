# AGENTS.md

Project-local guidance for `active/personal/calnix`.

## Start Here

- Read the repository root [README.md](../../../README.md) and root [AGENTS.md](../../../AGENTS.md) before making broad changes.
- Follow the local project `README.md` for machine-specific or setup-specific details.

## Conventions

- Follow DRY. Extract common configuration rather than duplicating it across modules or hosts.
- Follow normal NixOS module structure and naming conventions.
- Prefer shared reusable modules when the same setting would otherwise be repeated.

## Validation

- Run `nix flake check` when your changes affect flake outputs, modules, or shared configuration.

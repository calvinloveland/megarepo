# Secret protection in the megarepo

The megarepo auto-commits via the k33p daemon (`k33p daemon`, see
`k33p.yaml` → `daemon.auto_commit`), which runs `git add --update` + `git
commit` + `git push` on a debounce. Because the daemon does **not** use
`--no-verify`, any git hook you install runs on every auto-commit. This page
documents the layered secret-defense installed around that auto-committer.

## Layers (in order of where a secret is caught)

1. **`.gitignore` hardening** — `*.pem`, `*.key`, `id_rsa*`, `*.p12`, `*.pfx`,
   `*.secret`, `secrets.*`, age private identities. This only protects
   *untracked* secret files from ever being added. It does nothing for a
   secret pasted into an already-tracked source file.

2. **Pre-commit gitleaks scan** (`.githooks/pre-commit`) — scans *staged*
   changes with `gitleaks git --staged --config .gitleaks.toml`. On a finding
   it **fails closed** (blocks the commit) and writes a redacted report to
   `.gitleaks-report.json`. This is the layer that catches secrets pasted into
   tracked source.

3. **Secret lift into the `private` (secrets) channel** — when
   `K33P_LIFT_SECRETS=1` is set, the pre-commit hook calls
   `scripts/k33p_secret_lift.py`, which for each single-line finding:
   - age-encrypts the secret to the recipient in `.k33p/age-recipient.txt`,
   - stores the ciphertext as a `secret`-kind blob in the k33p content-addressed
     store (`.k33p/store/`),
   - rewrites the secret in the source file to a reference token
     `k33p+secret://sha256:<hash>`,
   - re-stages the file and appends a record to `.k33p/secrets-manifest.json`.
   The commit then proceeds **without** the secret. Multi-line findings are
   skipped (left in place) and the commit is blocked for manual handling.

4. **Pre-push gitleaks scan** (`.githooks/pre-push`) — scans the outgoing
   commit range. This is the backstop for `--no-verify` bypasses: even if
   pre-commit is skipped, a secret in pushed history blocks the push.

5. **GitHub Push Protection** (server-side, free for public repos) — the final
   net. Verify it is enabled in the repo's Settings → Code and automation →
   Code security → Secret scanning / Push protection. `gh auth login` is
   required to check or toggle this programmatically.

## Wiring

- `git config core.hooksPath .githooks` (already set on this clone) points git
  at the tracked `.githooks/` directory. New clones need this set once.
- `.gitleaks.toml` extends the vendored upstream default `gitleaks.default.toml`
  (kept pristine) and adds repo-specific allowlists (test fixtures, the k33p
  example manifests, the lift manifest). To update base rules, re-vendor
  `gitleaks.default.toml` from a gitleaks release.
- `gitleaks` and `age` are not required to be on `PATH`; the hooks fall back to
  `nix run nixpkgs#gitleaks` / `nix run nixpkgs#age`.

## Age key management

- Public recipient: `.k33p/age-recipient.txt` (committed).
- Private identity: `~/.config/k33p/age/megarepo-identity.txt` (off-repo,
  never committed; covered by `.gitignore`).
- Generate / rotate:
  ```
  nix shell nixpkgs#age -c age-keygen -o ~/.config/k33p/age/megarepo-identity.txt
  # then copy the printed "age1..." public key into .k33p/age-recipient.txt
  ```
- The `private` channel in `k33p.yaml` declares `encryption: age` and the same
  recipient under `recipients`.

## Recovering a lifted secret

```
# blob_hash is the hex in the k33p+secret://sha256:<hash> reference
nix run nixpkgs#python3 -- -c "
from pathlib import Path; import sys; sys.path.insert(0,'active/dev-tools/k33p/src')
from k33p.store import ContentStore
ct = ContentStore(Path('.k33p/store')).get('<blob_hash>')
Path('/tmp/secret.ct').write_bytes(ct or b'')
"
nix shell nixpkgs#age -c age -d -i ~/.config/k33p/age/megarepo-identity.txt -o /tmp/secret.txt /tmp/secret.ct
cat /tmp/secret.txt
```

## Escape hatches

- `GITLEAKS_SKIP=1 git commit --no-verify` — override pre-commit for a
  intentional secret fixture (e.g. a test token). **Pre-push still scans
  history**, so this is not a silent bypass.
- `K33P_LIFT_SECRETS=1` — opt into automatic lifting (default is block-only,
  the safer behavior for an auto-committer).
- The k33p daemon inherits the environment it was launched with. To enable
  lifting on auto-commits, restart the daemon with `K33P_LIFT_SECRETS=1` in its
  environment.

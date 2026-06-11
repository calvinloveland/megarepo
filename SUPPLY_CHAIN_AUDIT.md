# Supply-Chain Audit: Megarepo

## P0: Runtime installs in production paths (HIGHEST RISK)

### Dockerfiles with `pip install` at runtime (should be pre-built)
| Dockerfile | Issue |
|---|---|
| `active/games/lets-holdem-together/Dockerfile` | `pip install --no-cache-dir .` — no lockfile, no hash check |
| `active/dev-tools/hivemind-llm/coordinator/Dockerfile` | `pip install --no-cache-dir .` — no lockfile, no hash check |

### Dockerfiles with `apt-get install` (runtime deps in prod)
| Dockerfile | Issue |
|---|---|
| `active/web-apps/vernissage/Dockerfile` (build + runtime stages) | `apt-get install git openssl sqlite3 ca-certificates` — needed for prisma, but pulls mutable apt deps |

### CI workflow: runtime install
| File | Issue |
|---|---|
| `.github/workflows/publish-pages.yml:32-33` | `pip install -r docs/requirements.txt` — no hash check, unpinned transitive deps |

---

## P1: Missing lockfiles & unpinned deps (MODERATE RISK)

### Deployable web apps without requirements.lock
- `active/web-apps/recursive-thermofluid-sandbox/` — Dockerfile uses pip install, no lockfile
- `active/web-apps/parambulator/` — HAS lockfile ✅
- `active/web-apps/momos/` — HAS lockfile ✅

### Documentation build deps unpinned
- `docs/requirements.txt` — ranges (`>=1.6,<2`) not pinned to exact versions

---

## P2: Minor issues

- No tracked `node_modules/`, `.venv/`, or `.next/` in git ✅
- All CI actions pinned to SHA refs ✅ (both workflows use SHA pins for `actions/checkout`, `actions/setup-python`, `peaceiris/actions-gh-pages`)
- Direct git dependencies in pyproject.toml pinned to SHAs ✅ (`lazy_ci`, `full_auto_ci` both use `@<sha>`)

---

## Compaction verification

The audit read 20+ files across the repo, triggering **15 automatic compactions** during this session (confirmed in session log). Autopilot survived all of them — the `complete` tool, `agent_end` nudge, `/autopilot` command, and `/max-nudges` command all continued working correctly after each compaction.

**Automated test also confirms:** The new `"autopilot state survives context compaction"` test (44/44 passing) fires `session_compact` and verifies nudge counter, maxNudges, complete tool, and autopilot command all survive.

### Immediate action items
1. Fix `lets-holdem-together/Dockerfile` — replace `pip install .` with `pip install --require-hashes -r requirements.lock && pip install --no-deps .`
2. Fix `hivemind-llm/coordinator/Dockerfile` — same pattern
3. Pin `docs/requirements.txt` to exact versions with hash check
4. Check if `recursive-thermofluid-sandbox` needs lockfile before deployment

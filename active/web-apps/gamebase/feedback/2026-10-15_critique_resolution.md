# Whole-site critique — platform response

Resolution for the four audits (`2026-10-15_critique_onboarding-ux.md`,
`..._gameplay.md`, `..._platform-infra.md`, `..._visual-a11y.md`).

## P0

| Finding | Fix |
| --- | --- |
| Any guest can overwrite any published game | Games now carry an `owner_id`; API publishes may only update a game the same player created, and disk-managed games are rejected (`X-Admin-Token` overrides). Remixes record their creator as owner. |
| Same-origin iframe can steal the bearer token | Identity moved to an **httpOnly `gamebase_token` cookie**; the SDK and platform JS never read a token from `localStorage` (legacy tokens are cleared). `/api/session` + `/api/logout` added. Game JS can no longer exfiltrate the credential. |
| Tag gate blocks the whole site, not a modal | Gate is `role="dialog" aria-modal="true"` with a focus trap, `Escape` = guest, background marked `inert`, explanatory copy, a **Play as guest** button, larger tap targets, and `aria-live` error text. |

## P1

| Finding | Fix |
| --- | --- |
| `recovery_secret` leaked in player payloads | Player queries select only public columns; the secret never leaves the DB. |
| Unvalidated `meta`/manifest numbers → 500s + partial writes; no body limit | `meta` must be a mapping; manifest `points`/`matchmaking.players`/score bounds validated as numbers → 400; `MAX_CONTENT_LENGTH` (`GAMEBASE_MAX_CONTENT_BYTES`) added; unknown `unlock` ids are ignored instead of 404ing after a save. |
| Deleting a game folder leaves a phantom entry | Rescan reconciles: games missing from disk are deleted along with their scores/achievements/comments/ratings/plays. |
| SSE streams exhaust the single worker | `Gamebase.waitForMatch()` now **polls by default**; SSE is opt-in via `{stream: true}`, and the stream timeout is capped at 60s. |
| 404s return raw JSON | Browser requests get an HTML error page; `/api/*` (or `Accept: application/json`) still get JSON. 413/500 handled too. |
| 2048 win never submits the run | Winning now calls `submitRun()`; a later, higher-scoring end-of-game submission is still allowed. |
| Reversi "Dominant" / Connect Four "Blitz" unlock on a loss | Added compound `criteria.type: all`; both now require `result = win` **and** the margin/move bound. |
| Chess K+B+B vs K declared a draw | `insufficientMaterial` now only draws K vs K, K+minor vs K, and K+B vs K+B on same-coloured squares. |
| Play counts were page views | The SDK records a play on the **first user input** inside the game (`pointerdown`/`keydown`/`touchstart`), so a launch that is never played isn't counted. |
| Rating/leaderboard/achievements buried under comments on mobile | Comments are now a full-width panel that stacks after the sidebar; on mobile the order is game → rating/scores/achievements → comments. |
| Keyboard games look broken until clicked | The iframe is focusable with a visible focus ring and a "Click the game to focus keyboard controls" hint. |
| Comment textarea unlabeled; stars expose no state; status text silent | Label added, stars are a `radiogroup` with `aria-checked`, status/rating text use `aria-live`, sort links use `aria-current`, decorative icons are `aria-hidden`, and the catalog has an `sr-only` heading + search. |
| Identity invisible/unchangeable/unrecoverable | Header shows the current tag; clicking it reveals the recovery code with copy, plus a "New tag" logout. |
| Raw ISO comment timestamps | Comments render humanised times ("2h ago") from the API and server-side. |

## P2 (addressable now)

- Hero's admin "Rescan registry" moved to the footer.
- Catalog search box added; "Newest" is still imperfect because all games are
  first-seen at once (documented).
- Player profiles now list ratings and comments instead of being empty.
- Star display rounds to nearest instead of flooring.
- `prefers-reduced-motion` honoured; low-contrast off-stars brightened;
  small tap targets enlarged on mobile.
- Security headers added (`X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`).
- `AGENT_GUIDE.md` now includes the REST contract and the ownership rule.

## Still open (documented, larger)

- Per-game sandbox isolation (opaque origin + `postMessage` broker). The
  httpOnly cookie removes token theft, but a published game can still act as the
  current player.
- Session expiry / rotation; durable accounts. Recovery codes cover basic
  cross-device play.
- "Newest" sort needs a per-game first-seen timestamp distinct from bulk sync.

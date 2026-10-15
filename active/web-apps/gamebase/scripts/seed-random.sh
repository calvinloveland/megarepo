#!/usr/bin/env bash
# Seed a running Gamebase instance with genuinely random activity.
#
#   GAMEBASE_URL=http://127.0.0.1:5199 bash scripts/seed-random.sh [players] [games_each]
#
# Every value comes from /dev/urandom, so each run produces different data:
# random 3-letter tags, ratings, comments, plays, and in-range scores.
#
# Requires: bash, curl, python3 (only to parse the catalog JSON).
set -euo pipefail

BASE="${GAMEBASE_URL:-http://127.0.0.1:5199}"
PLAYERS="${1:-16}"
GAMES_EACH="${2:-6}"

for tool in curl python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "missing dependency: $tool" >&2; exit 1; }
done

# ── randomness ──────────────────────────────────────────────────────────────
urand() { od -An -N4 -tu4 /dev/urandom | tr -d ' '; }
rand_range() { # inclusive
  local lo="$1" hi="$2"
  local span=$(( hi - lo + 1 ))
  echo $(( lo + $(urand) % span ))
}
rand_tag() {
  # Read a fixed chunk (no SIGPIPE) then keep the first 3 alphanumerics.
  local pool
  pool=$(head -c 96 /dev/urandom | LC_ALL=C tr -dc 'A-Z0-9')
  printf '%s' "${pool:0:3}"
}

COMMENTS=(
  "great little time waster"
  "controls feel tight"
  "the AI is surprisingly tough"
  "wish there was a harder mode"
  "played this way too long"
  "clean and simple, love it"
  "the high score chase is addictive"
  "needs a mobile tweak but fun"
  "perfect coffee-break game"
  "solid retro vibes"
  "finally beat my record"
  "the soundtrack is stuck in my head"
)

echo "== seeding $BASE =="

# slug|min|max for every game that declares a leaderboard
GAMES=$(curl -fsS "$BASE/api/games" | python3 -c '
import json, sys
for g in json.load(sys.stdin)["games"]:
    lb = (g.get("capabilities") or {}).get("leaderboard") or {}
    lo = lb.get("min")
    hi = lb.get("max")
    print("{}|{}|{}".format(g["slug"], lo if lo is not None else 0, hi if hi is not None else 100000))
')

if [ -z "$GAMES" ]; then
  echo "no games found at $BASE" >&2
  exit 1
fi

game_count=$(printf '%s\n' "$GAMES" | wc -l)
echo "games: $game_count  players: $PLAYERS"

made=0
IDENTITY_JSON=$(mktemp -t gb-seed-identity.XXXXXX)
trap 'rm -f "$IDENTITY_JSON"' EXIT
for (( p=0; p<PLAYERS; p++ )); do
  token=""
  for _ in 1 2 3 4 5 6; do
    candidate="$(rand_tag)"
    code=$(curl -s -o "$IDENTITY_JSON" -w '%{http_code}' \
      -X POST "$BASE/api/identity" -H 'Content-Type: application/json' \
      --data "{\"handle\":\"$candidate\"}")
    if [ "$code" = "201" ]; then
      token=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$IDENTITY_JSON")
      break
    fi
  done
  [ -z "$token" ] && continue
  made=$(( made + 1 ))

  # GAMES_EACH distinct games, shuffled with the kernel RNG
  while IFS='|' read -r slug lo hi; do
    [ -z "$slug" ] && continue
    curl -s -o /dev/null -X POST "$BASE/api/games/$slug/rating" \
      -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
      --data "{\"rating\":$(rand_range 1 5)}"

    for (( k=0, n=$(rand_range 1 3); k<n; k++ )); do
      curl -s -o /dev/null -X POST "$BASE/api/games/$slug/play" \
        -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data '{}'
    done

    curl -s -o /dev/null -X POST "$BASE/api/games/$slug/scores" \
      -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
      --data "{\"score\":$(rand_range "$lo" "$hi")}"

    if [ "$(rand_range 0 1)" = "1" ]; then
      idx=$(rand_range 0 $((${#COMMENTS[@]} - 1)))
      curl -s -o /dev/null -X POST "$BASE/api/games/$slug/comments" \
        -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
        --data "{\"body\":\"${COMMENTS[$idx]}\"}"
    fi
  done < <(printf '%s\n' "$GAMES" | sort -R | head -n "$GAMES_EACH")
done

echo "== seeded $made random players =="

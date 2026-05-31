#!/usr/bin/env bash
# ==============================================================================
# Powder Play — automated playtest
#
# Simulates a player mixing starter materials on a grid.
# Calls the LLM for each pair, records results, chain-mixes.
# ==============================================================================
set -uo pipefail

MIX_API="${MIX_API:-http://localhost:8787}"
MAX_DISCOVERIES=15

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║            POWDER PLAY — AUTOMATED PLAYTEST                 ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# ── Starter materials ──────────────────────────────────────────────
STARTERS=("Fire" "Sand" "Water" "Dirt" "Seed" "Iron" "Salt")

# Tags for each starter (from JSON files)
declare -A STARTER_TAGS
STARTER_TAGS[Fire]="float fire burns_out"
STARTER_TAGS[Sand]="sand"
STARTER_TAGS[Water]="flow water"
STARTER_TAGS[Dirt]="sand dirt"
STARTER_TAGS[Seed]="sand seed"
STARTER_TAGS[Iron]="element static"
STARTER_TAGS[Salt]="sand"

# Track discoveries: DISCOVERED["A|B"]="Name"
declare -A DISCOVERED
DISCOVERED_NAMES=()

# Deduplication helper
pair_exists() {
  local a="$1" b="$2"
  for key in "${!DISCOVERED[@]}"; do
    local IFS='|' read -ra parts <<< "$key"
    if { [ "${parts[0]}" = "$a" ] && [ "${parts[1]}" = "$b" ]; } || \
       { [ "${parts[0]}" = "$b" ] && [ "${parts[1]}" = "$a" ]; }; then
      return 0
    fi
  done
  return 1
}

# ── Helper: get a material's tags ──────────────────────────────────
get_tags() {
  local name="$1"
  echo "${STARTER_TAGS[$name]:-static}"
}

# ── Call LLM for a name ───────────────────────────────────────────
llm_name() {
  local a="$1" b="$2"
  # Build recent mix lines
  local recent=""
  for key in "${!DISCOVERED[@]}"; do
    local a_name="${key%%|*}"
    local b_name="${key##*|}"
    recent+="${a_name}+${b_name}=${DISCOVERED[$key]}"$'\n'
  done
  
  local prompt="${recent}${a}+${b}="
  # Escape for JSON: replace " with \", newlines with \n
  local escaped=$(echo "$prompt" | sed 's/"/\\"/g' | awk '{printf "%s\\n", $0}' | sed 's/\\n$//')
  
  local resp=$(curl -s "$MIX_API/llm" -H "Content-Type: application/json" -d "{
    \"prompt\": \"$escaped\",
    \"system\": \"Respond with a single word name for the new material. Return only the name.\",
    \"options\": {\"temperature\": 0.2, \"num_predict\": 16}
  }' 2>/dev/null)
  
  local name=$(echo "$resp" | sed 's/.*"response":"\([^"]*\)".*/\1/' 2>/dev/null || echo "")
  name=$(echo "$name" | tr -d '\n\r' | xargs)
  
  local a_lower=$(echo "$a" | tr '[:upper:]' '[:lower:]')
  local b_lower=$(echo "$b" | tr '[:upper:]' '[:lower:]')
  local n_lower=$(echo "$name" | tr '[:upper:]' '[:lower:]')
  
  if [ -z "$name" ] || [ "$n_lower" = "$a_lower" ] || [ "$n_lower" = "$b_lower" ]; then
    echo ""
    return
  fi
  echo "$name"
}

# ── Direct curl helper with proper JSON escaping ──────────────────
llm_query() {
  local prompt="$1"
  local system="$2"
  local max_tokens="${3:-16}"
  
  # Build JSON manually with proper escaping
  local p_escaped=$(echo "$prompt" | sed 's/"/\\"/g' | sed ":a;N;\$!ba;s/\n/\\n/g")
  local s_escaped=$(echo "$system" | sed 's/"/\\"/g' | sed ":a;N;\$!ba;s/\n/\\n/g")
  
  curl -s "$MIX_API/llm" -H "Content-Type: application/json" -d "{
    \"prompt\": \"$p_escaped\",
    \"system\": \"$s_escaped\",
    \"options\": {\"temperature\": 0.2, \"num_predict\": $max_tokens}
  }" 2>/dev/null
}

# ── Extract response field from JSON ───────────────────────────────
get_response() {
  local json="$1"
  echo "$json" | sed 's/.*"response":"\([^"]*\)".*/\1/' 2>/dev/null || echo ""
}

# ── Determine byproduct ────────────────────────────────────────────
byproduct_for() {
  local a_tags=$(get_tags "$1")
  local b_tags=$(get_tags "$2")
  local all="$a_tags $b_tags"
  if echo "$all" | grep -qE '(fire|explosive|reactive_water)'; then
    echo "Heat"
  elif echo "$all" | grep -qE 'water' && echo "$all" | grep -qE '(flow|float)'; then
    if [ $((RANDOM % 10)) -lt 3 ]; then echo "Pressure"; fi
  fi
}

# ── Mix two materials ──────────────────────────────────────────────
do_mix() {
  local a="$1" b="$2"
  
  if [ "$a" = "$b" ]; then return; fi
  if pair_exists "$a" "$b"; then return; fi
  
  echo ""
  echo "  ── $a + $b ──"
  
  local name_resp=$(llm_query "${a}+${b}=" "Respond with a single word name for a new material made from ${a} and ${b}. Return only the name." 16)
  local name=$(get_response "$name_resp")
  
  local a_lower=$(echo "$a" | tr '[:upper:]' '[:lower:]')
  local b_lower=$(echo "$b" | tr '[:upper:]' '[:lower:]')
  local n_lower=$(echo "$name" | tr '[:upper:]' '[:lower:]')
  
  if [ -z "$name" ]; then
    name="${a}_${b}_mix"
    echo "    LLM: (empty) → fallback $name"
  elif [ "$n_lower" = "$a_lower" ] || [ "$n_lower" = "$b_lower" ]; then
    echo "    LLM: '$name' (generic) → fallback"
    name="${a}_${b}_mix"
  else
    echo "    LLM: $name"
  fi
  
  # LLM density
  local den_resp=$(llm_query "${name} density:" "Respond with a single number for the density of ${name}." 8)
  local density=$(get_response "$den_resp" | grep -oE '^[0-9]+(\.[0-9]+)?' || echo "")
  if [ -z "$density" ]; then density="(avg)"; fi
  
  # LLM color
  local col_resp=$(llm_query "${name} color:" "Respond with three numbers 0-255 separated by commas for the RGB color of ${name}." 10)
  local color=$(get_response "$col_resp")
  local color_ok=$(echo "$color" | grep -cE '[0-9]+,[0-9]+,[0-9]+' 2>/dev/null || echo "0")
  if [ "$color_ok" = "0" ]; then color="(hash)"; fi
  
  # Byproduct
  local byproduct=$(byproduct_for "$a" "$b")
  local bp_str=""
  if [ -n "$byproduct" ]; then bp_str=" + $byproduct"; fi
  
  DISCOVERED["${a}|${b}"]="$name"
  DISCOVERED_NAMES+=("$name")
  
  echo "    → $name${bp_str}"
  echo "      density: $density  color: $color"
}

# ═══════════════════════════════════════════════════════════════════
echo ""
echo "═══ PHASE 1: First-order mixes (starter pairs) ═══"

MIX_COUNT=0
for ((i=0; i<${#STARTERS[@]}; i++)); do
  for ((j=i+1; j<${#STARTERS[@]}; j++)); do
    [ $MIX_COUNT -ge $MAX_DISCOVERIES ] && break 2
    do_mix "${STARTERS[$i]}" "${STARTERS[$j]}"
    ((MIX_COUNT++))
  done
done

echo ""
echo "═══ PHASE 2: Chain mixes (discovery + starter) ═══"

for ((d=0; d<${#DISCOVERED_NAMES[@]}; d++)); do
  local disc="${DISCOVERED_NAMES[$d]}"
  for starter in "${STARTERS[@]}"; do
    [ $MIX_COUNT -ge $MAX_DISCOVERIES ] && break 2
    if ! pair_exists "$disc" "$starter"; then
      do_mix "$disc" "$starter"
      ((MIX_COUNT++))
    fi
  done
done

echo ""
echo "═══ PHASE 3: Discovery + discovery mixes ═══"

for ((i=0; i<${#DISCOVERED_NAMES[@]}; i++)); do
  for ((j=i+1; j<${#DISCOVERED_NAMES[@]}; j++)); do
    [ $MIX_COUNT -ge $MAX_DISCOVERIES ] && break 2
    if ! pair_exists "${DISCOVERED_NAMES[$i]}" "${DISCOVERED_NAMES[$j]}"; then
      do_mix "${DISCOVERED_NAMES[$i]}" "${DISCOVERED_NAMES[$j]}"
      ((MIX_COUNT++))
    fi
  done
done

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "                     PLAYTEST RESULTS"
echo "══════════════════════════════════════════════════════════════"
echo "Starters: ${STARTERS[*]}"
echo "Discoveries: $MIX_COUNT"
echo ""
for key in "${!DISCOVERED[@]}"; do
  local name="${DISCOVERED[$key]}"
  local a="${key%%|*}"
  local b="${key##*|}"
  local bp=$(byproduct_for "$a" "$b")
  local bp_disp=""
  [ -n "$bp" ] && bp_disp=" [+$bp]"
  printf "  %-20s from %s + %s%s\n" "● $name" "$a" "$b" "$bp_disp"
done

echo ""
if echo "${DISCOVERED_NAMES[@]}" | grep -qi "gold"; then
  echo "🎉 GOLD DISCOVERED! You win!"
else
  echo "💡 Gold not yet discovered."
fi
echo ""

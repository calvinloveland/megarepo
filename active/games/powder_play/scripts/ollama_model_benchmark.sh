#!/usr/bin/env bash
set -uo pipefail
models=$(ollama list | tail -n +2 | awk '{print $1}')
if [ -z "$models" ]; then
  echo "No models found"
  exit 1
fi
PROMPTS=(
  "tags: Provide a short comma-separated list of tags for mixing Salt and Water. Return only tags."
  "density: Provide a single numeric density for mixing Salt and Water. Return only the number."
  "color: Provide a single RGB array like [R,G,B] for mixing Salt and Water. Return only the array."
  "desc: Provide a one-sentence description for mixing Salt and Water. Return only the sentence."
  "single: Create a material that represents mixing Salt and Water. Return ONLY JSON with fields: type, name, description, tags, density, color."
)

for model in $models; do
  echo "\n=== MODEL: $model ==="
  for p in "${PROMPTS[@]}"; do
    label=$(echo "$p" | awk -F: '{print $1}')
    prompt=$(echo "$p" | awk -F: '{print $2}')
    echo "-- prompt: $label"
    start=$(date +%s%3N)
    # run and capture output and exit code
    outfile=$(mktemp)
    errfile=$(mktemp)
    ollama run "$model" --verbose --format text "$prompt" >"$outfile" 2>"$errfile" || true
    end=$(date +%s%3N)
    dur=$((end-start))

    echo "time_ms: $dur"
    echo "stdout:"; sed -n '1,5p' "$outfile"
    echo "stderr:"; sed -n '1,20p' "$errfile"
    rm -f "$outfile" "$errfile"
  done
  echo ""
done

# Summary note
echo "Benchmark complete. Note: per-model results printed above." 

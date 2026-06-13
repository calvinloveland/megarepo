# tools/generate_demos.py

Generates 16-second MP4 demo videos for every project registered in
`../apps.yaml`. Each video is a branded title-card animation:

- 1280×720 @ 30 fps, ~16 seconds, ~280 KB
- Project name (typewriter reveal)
- Monogram "container card" with type pill (`FLASK` / `NEXTJS` / `VITE` / `NODE`)
- Project description (line-by-line reveal)
- Tech badges: `TYPE`, `PORT`, `DOMAIN`
- Mock terminal panel typing the start command
- Mock browser panel showing the public URL
- Fade to black

The visual language mirrors the launcher UI (dark slate, green accent,
monospaced type).

## Run

From the launcher directory:

```bash
nix-shell -p python3Packages.pillow python3Packages.pyyaml ffmpeg \
    --run "python3 tools/generate_demos.py"
```

Useful flags:

```bash
# Render a single demo
python3 tools/generate_demos.py --only momos

# Render a subset
python3 tools/generate_demos.py --only momos,parambulator,vernissage

# Custom output directory
python3 tools/generate_demos.py --out /tmp/demos

# Keep intermediate PNG frames (for debugging)
python3 tools/generate_demos.py --keep-frames
```

## Output

Videos land in `demos/<app-id>.mp4` (e.g. `demos/momos.mp4`). They are
served by the launcher at `/demos/<app-id>.mp4` and indexed by
`/api/demos`.

## Re-rendering posters

The Demos tab in the launcher uses a JPEG poster (a representative frame
around t=5s) as the thumbnail. To regenerate them in bulk:

```bash
cd active/web-apps/launcher
mkdir -p static/demos
for mp4 in demos/*.mp4; do
  id=$(basename "$mp4" .mp4)
  ffmpeg -i "$mp4" -ss 5 -vframes 1 -q:v 5 -y "static/demos/${id}.jpg"
done
```

## Adding a new demo

Add a new entry to `apps.yaml`, then re-run the generator. The new
demo will be picked up automatically and exposed via the **Demos** tab
and the **▶ DEMO** button on the corresponding container card.

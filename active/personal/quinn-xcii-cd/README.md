# quinn-xcii-cd

Build a Red Book audio CD of Quinn XCII's most popular tracks. Curated 24-track
running order (75:46), plus a burn script that transcodes, verifies, and writes
the disc.

Full docs: [docs/index.md](docs/index.md) · tracklist: [docs/tracklist.md](docs/tracklist.md)

```sh
nix-shell --run 'scripts/burn-cd.sh'          # dry run
nix-shell --run 'scripts/burn-cd.sh --burn'   # write the disc
```

Sourcing the audio is manual and legal-only (Bandcamp, iTunes, Amazon, Qobuz).
See the docs for the exact file naming the script expects.

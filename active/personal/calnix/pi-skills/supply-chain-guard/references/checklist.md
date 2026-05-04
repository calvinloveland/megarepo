# Supply Chain Guard Checklist

## Inventory

- manifests: `pyproject.toml`, `requirements*.txt`, `package.json`, lockfiles
- build paths: Dockerfiles, Nix flakes, devcontainer bootstrap
- deploy paths: Kubernetes manifests, deploy scripts, CI release workflows
- CI actions and permissions

## Fail the build for

- `uses: ... @vN` / `@main` / `@master`
- `node_modules/` or `.venv/` tracked in git
- branch tarball downloads in production manifests
- runtime `pip install`, `npm install`, or `apt-get install` in production startup logic
- direct `git+https://...git` dependencies without a commit SHA
- deployable apps with no lockfile

## Preferred remediations

- prebuilt images instead of mutable pod bootstrap
- `npm ci` instead of `npm install`
- locked Python dependencies with hashes for deployables
- immutable image tags or digests during rollout
- deployment helpers that preserve secrets while updating images

## Final verification

- run the repo guard script
- run the relevant image/app build
- review docs for stale instructions that still mention mutable bootstrap patterns

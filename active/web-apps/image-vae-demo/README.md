# image-vae Web Demo

Interactive demo for the [image-vae](../../dev-tools/image-vae) extreme image compressor.

## What it does

- Upload any image → see it compressed to ~1 KB and reconstructed
- Inspect the `.vae` binary format byte by byte
- Learn how the VAE architecture works

## Run locally

```bash
# Make sure the image-vae package and its venv are set up
cd ../../dev-tools/image-vae
# ... follow its README to install deps and train a model

# Start this demo
cd ../../web-apps/image-vae-demo
PYTHONPATH="src:../../dev-tools/image-vae" \
LD_LIBRARY_PATH="/nix/store/si4q3zks5mn5jhzzyri9hhd3cv789vlm-gcc-15.2.0-lib/lib" \
../../dev-tools/image-vae/.venv/bin/python3 -m image_vae_demo.app
```

Then open http://localhost:5114.

## Launcher registration

Already registered in `../launcher/apps.yaml` as:

```yaml
- id: image-vae-demo
  name: Image VAE Demo
  subdomain: vae
  type: flask
  port: 5114
  module: image_vae_demo.app
```

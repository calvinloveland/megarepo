"""Flask app for the image-vae interactive demo."""

from __future__ import annotations

import io
import os
import sys
import struct
import tempfile
from pathlib import Path
from typing import Optional

import torch
from flask import Flask, jsonify, render_template, request, send_file

# Add the image-vae package to the path
_IMAGE_VAE_PATH = Path(__file__).resolve().parents[4] / "dev-tools" / "image-vae"
if _IMAGE_VAE_PATH.exists():
    sys.path.insert(0, str(_IMAGE_VAE_PATH))

from image_vae import VAE
from image_vae.compression import (
    compress_image_pil,
    decompress_image,
    CompressedImage,
    HEADER_SIZE,
    HEADER_FORMAT,
    IMAGE_VAE_MAGIC,
    FLAG_ENTROPY_CODED,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = _IMAGE_VAE_PATH / "checkpoints" / "synth_demo.pt"
DEFAULT_MODEL_PATH = _IMAGE_VAE_PATH / "checkpoints" / "vae_final.pt"

app = Flask(
    __name__,
    template_folder=str(PROJECT_ROOT / "templates"),
    static_folder=str(PROJECT_ROOT / "static"),
    static_url_path="/static",
)

# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

_model: Optional[VAE] = None
_model_loaded = False
_model_path_used = None


def load_model() -> VAE:
    """Load the VAE model (cached). Returns the model."""
    global _model, _model_loaded, _model_path_used

    if _model_loaded:
        return _model

    # Try several possible checkpoint paths
    candidates = [
        MODEL_PATH,
        DEFAULT_MODEL_PATH,
        _IMAGE_VAE_PATH / "checkpoints" / "synth_demo.pt",
    ]
    ckpt_path = None
    for cp in candidates:
        if cp.exists():
            ckpt_path = cp
            break

    if ckpt_path is None:
        # No trained model found — create an untrained one for demo purposes
        print("No checkpoint found. Creating untrained demo model.")
        _model = VAE(latent_dim=1000, img_size=128)
        _model_loaded = True
        return _model

    print(f"Loading checkpoint: {ckpt_path}")
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    _model = VAE(
        latent_dim=ckpt.get("latent_dim", 1000),
        img_channels=ckpt.get("img_channels", 3),
        img_size=ckpt.get("img_size", 64),
        base_channels=ckpt.get("base_channels", 64),
        max_channels=ckpt.get("max_channels", 512),
    )
    _model.load_state_dict(ckpt["model_state_dict"])
    _model.eval()
    _model_loaded = True
    _model_path_used = ckpt_path
    print(f"Model loaded: latent_dim={_model.latent_dim}, img_size={_model.img_size}, "
          f"base_channels={_model.base_channels}")
    return _model


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.route("/")
def index():
    model = load_model()
    return render_template(
        "index.html",
        latent_dim=model.latent_dim,
        img_size=model.img_size,
        model_loaded=_model_loaded,
        model_path=str(_model_path_used) if _model_path_used else None,
        sample_rate=16,  # downsampling for upload preview
        max_upload_mb=10,
    )


@app.route("/api/compress", methods=["POST"])
def api_compress():
    """
    Compress an uploaded image and return original/compressed/decompressed + stats.

    Accepts multipart form with 'image' file and optional 'entropy' checkbox.
    """
    if "image" not in request.files:
        return jsonify({"error": "No image uploaded"}), 400

    file = request.files["image"]
    if file.filename == "":
        return jsonify({"error": "Empty filename"}), 400

    use_entropy = request.form.get("entropy", "false") == "true"

    try:
        from PIL import Image

        # Read uploaded image
        img_bytes = file.read()
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        orig_w, orig_h = img.size

        # Limit input size to prevent abuse
        max_dim = 1024
        if orig_w > max_dim or orig_h > max_dim:
            scale = min(max_dim / orig_w, max_dim / orig_h)
            new_w = int(orig_w * scale)
            new_h = int(orig_h * scale)
            img = img.resize((new_w, new_h), Image.LANCZOS)

        # Compress
        model = load_model()
        compressed = compress_image_pil(model, img, entropy=use_entropy)
        ci = CompressedImage(compressed)

        # Decompress
        recon = decompress_image(model, compressed)

        # Use PNG for lossless comparison
        orig_buf = io.BytesIO()
        img.save(orig_buf, format="PNG")
        orig_buf.seek(0)

        recon_buf = io.BytesIO()
        recon.save(recon_buf, format="PNG")
        recon_buf.seek(0)

        import base64

        compressed_b64 = base64.b64encode(compressed).decode("ascii")

        orig_file_size = len(img_bytes)
        ratio = orig_file_size / len(compressed) if len(compressed) > 0 else 0

        return jsonify(
            {
                "original_size": orig_file_size,
                "compressed_size": len(compressed),
                "compressed_size_kb": round(len(compressed) / 1024, 2),
                "ratio": round(ratio, 1),
                "orig_w": ci.orig_w,
                "orig_h": ci.orig_h,
                "effective_img_size": model.img_size,
                "latent_dim": ci.latent_dim,
                "q_min": round(ci.q_min, 4),
                "q_max": round(ci.q_max, 4),
                "entropy_coded": ci.is_entropy_coded,
                "flags": ci.flags,
                "original_image": base64.b64encode(orig_buf.getvalue()).decode("ascii"),
                "reconstructed_image": base64.b64encode(recon_buf.getvalue()).decode("ascii"),
                "compressed_data": compressed_b64,
            }
        )
    except Exception as e:
        import traceback

        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    """
    Analyze a .vae file — read and display its header/metadata.
    """
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "Empty filename"}), 400

    try:
        data = file.read()

        if len(data) < HEADER_SIZE:
            return jsonify({"error": f"File too small ({len(data)} bytes)"}), 400

        header = data[:HEADER_SIZE]
        magic, w, h, latent_dim, q_min, q_max, flags = struct.unpack(
            HEADER_FORMAT, header
        )

        if magic != IMAGE_VAE_MAGIC:
            return jsonify(
                {
                    "error": f"Invalid magic bytes: {magic!r} (expected {IMAGE_VAE_MAGIC!r})"
                }
            ), 400

        latency_payload = data[HEADER_SIZE:]
        entropy_coded = bool(flags & FLAG_ENTROPY_CODED)

        # For entropy-coded data, decode to find actual compressed vs table sizes
        if entropy_coded:
            from image_vae.entropy import read_huffman_payload

            table, comp_data = read_huffman_payload(latency_payload)
            table_size = len(table)
            comp_latent_size = len(comp_data)
        else:
            table_size = 0
            comp_latent_size = len(latency_payload)

        return jsonify(
            {
                "magic": magic.decode("ascii", errors="replace"),
                "width": w,
                "height": h,
                "latent_dim": latent_dim,
                "q_min": round(q_min, 4),
                "q_max": round(q_max, 4),
                "flags": f"0x{flags:08x}",
                "entropy_coded": entropy_coded,
                "file_size": len(data),
                "header_size": HEADER_SIZE,
                "table_size": table_size,
                "latent_data_size": comp_latent_size,
                "total_payload_size": len(latency_payload),
                "file_size_kb": round(len(data) / 1024, 2),
            }
        )
    except Exception as e:
        import traceback

        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/api/status")
def api_status():
    """Return model and server status."""
    model = load_model()
    return jsonify(
        {
            "model_loaded": _model_loaded,
            "latent_dim": model.latent_dim,
            "img_size": model.img_size,
            "model_path": str(_model_path_used) if _model_path_used else None,
        }
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5114))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"Starting image-vae demo on {host}:{port}")
    load_model()
    app.run(host=host, port=port, debug=True)

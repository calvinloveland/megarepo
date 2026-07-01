#!/usr/bin/env bash
# ─── Train the 1KB VAE on a proper dataset ──────────────────────────
# Run this on a machine with a GPU for best results.
#
# Adjust these variables for your setup:
DATASET_DIR="${DATASET_DIR:-./data/celeba}"   # path to training images
IMG_SIZE=128                                   # 128 = good quality, 64 = faster
LATENT_DIM=1000                                # 1000 dim → ~1KB compressed
BASE_CHANNELS=64                               # 64=full, 32=half-size, 16=tiny
BATCH_SIZE=128                                 # reduce if OOM on your GPU
EPOCHS=200                                     # 100-200 for convergence
LR=1e-3

# Derived
MODEL_DIR="./checkpoints/run_$(date +%Y%m%d_%H%M)"
mkdir -p "$MODEL_DIR"

echo "═══ Training 1KB VAE ═══"
echo "  Dataset:    $DATASET_DIR"
echo "  Image size: $IMG_SIZE × $IMG_SIZE"
echo "  Latent dim: $LATENT_DIM  →  $(($LATENT_DIM + 28)) bytes per image"
echo "  Channels:   base=$BASE_CHANNELS  max=512"
echo "  Batch:      $BATCH_SIZE"
echo "  Epochs:     $EPOCHS"
echo "  LR:         $LR"
echo "  Output:     $MODEL_DIR"
echo ""

# ─── Dataset preparation ───────────────────────────────────────
if [ ! -d "$DATASET_DIR" ]; then
    echo "Dataset directory not found: $DATASET_DIR"
    echo ""
    echo "Options:"
    echo "  1. Download CelebA:  kaggle datasets download jessicali9530/celeba-dataset"
    echo "  2. Use your own:     point DATASET_DIR at a folder of .jpg/.png files"
    echo "  3. Use CIFAR-10:    omit --data-dir (trains on 32×32 CIFAR-10)"
    echo ""
    echo "Falling back to CIFAR-10 for quick testing..."
    DATASET_DIR=""
fi

# ─── Train ─────────────────────────────────────────────────────
python -m image_vae.cli train \
    --latent-dim "$LATENT_DIM" \
    --img-size "$IMG_SIZE" \
    --base-channels "$BASE_CHANNELS" \
    --batch-size "$BATCH_SIZE" \
    --epochs "$EPOCHS" \
    --lr "$LR" \
    --model-dir "$MODEL_DIR" \
    ${DATASET_DIR:+--data-dir "$DATASET_DIR"} \
    --device auto

echo ""
echo "═══ Done ═══"
echo "Model saved to: $MODEL_DIR/vae_final.pt"
echo "To compress an image:"
echo "  python -m image_vae.cli compress $MODEL_DIR/vae_final.pt photo.jpg photo.vae"
echo "To start the web demo:"
echo "  cd ../../web-apps/image-vae-demo"
echo "  ./run.sh  # or follow README.md"

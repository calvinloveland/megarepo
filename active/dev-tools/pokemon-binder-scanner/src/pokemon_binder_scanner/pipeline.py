import argparse
import os
import cv2
import numpy as np
from pathlib import Path
from tqdm import tqdm
from typing import Optional
from urllib.request import urlretrieve
import errno
import json


def _build_arg_parser():
    p = argparse.ArgumentParser(description="Extract, align, and stack frames from a video to produce a denoised image.")
    p.add_argument('--video', required=True, help='Path to input video (mp4, mov, etc)')
    p.add_argument('--out', required=True, help='Path to output image (png, tif, tiff)')
    p.add_argument('--frame-interval', type=float, default=0.25, help='Seconds between sampled frames')
    p.add_argument('--max-frames', type=int, default=0, help='Maximum number of frames to use (0 = no limit)')
    p.add_argument('--stack', choices=['mean', 'median'], default='mean', help='Stacking method')
    p.add_argument('--resize', type=float, default=1.0, help='Scale factor after alignment (e.g., 1.5)')
    p.add_argument('--crop', type=str, default='', help='x,y,w,h crop before processing')
    p.add_argument('--save-steps', action='store_true', help='Save extracted and aligned frames')
    p.add_argument('--sharpen', action='store_true', help='Apply mild unsharp mask at the end')
    # Presets
    p.add_argument('--preset', type=str, default='', help='Path to a JSON file with pipeline parameters. If "best", uses presets/best.json or output/benchmark/best.json. Values act as defaults and are overridden by explicit CLI flags.')
    # Super-resolution options (OpenCV dnn_superres)
    p.add_argument('--superres-model', choices=['espcn', 'edsr', 'fsrcnn', 'lapsrn', 'cs', 'cs-multi', 'fista-dct', 'fista-dct-multi', 'off'], default='off',
                   help='Enable model-based super-resolution using OpenCV dnn_superres')
    p.add_argument('--superres-scale', type=int, default=2,
                   help='Upscale factor for super-resolution (2, 3, 4; LapSRN also supports 8)')
    p.add_argument('--superres-model-path', type=str, default='',
                   help='Path to the super-resolution model file (.pb). If omitted, a default cache path is used.')
    p.add_argument('--superres-auto-download', action='store_true',
                   help='Automatically download the model file to a cache directory if missing')
    p.add_argument('--superres-auto-scale', action='store_true',
                   help='Auto-estimate the best SR scale from sub-pixel shifts and sharpness (prefers 2..4)')
    p.add_argument('--max-auto-scale', type=int, default=4,
                   help='Upper bound for auto-selected SR scale (default 4)')
    # Reporting / diagnostics
    p.add_argument('--report-metrics', action='store_true', help='Write a JSON metrics report next to the output image')
    p.add_argument('--metrics-path', type=str, default='', help='Optional explicit path to write metrics JSON')
    # Compressed-sensing style SR params (iterative back-projection + TV denoising)
    p.add_argument('--cs-iterations', type=int, default=8, help='Number of IBP iterations for cs SR')
    p.add_argument('--cs-alpha', type=float, default=0.7, help='Back-projection step size for cs SR')
    p.add_argument('--cs-tv-weight', type=float, default=0.1, help='TV denoising weight (0 disables TV)')
    p.add_argument('--cs-blur-sigma', type=float, default=1.2, help='Gaussian blur sigma used in LR forward model')
    # FISTA-DCT parameters
    p.add_argument('--dct-lambda', type=float, default=0.01, help='L1 weight on DCT coefficients for FISTA-DCT SR')
    p.add_argument('--fista-step', type=float, default=0.5, help='FISTA gradient step size for data fidelity term')
    # Sub-pixel shift estimation for multi-frame SR
    p.add_argument('--align-subpixel', action='store_true', help='Use sub-pixel shifts (phase correlation) for multi-frame SR')
    p.add_argument('--align-upsampling', type=int, default=50, help='Upsampling factor for sub-pixel shift estimation')
    # Frame selection
    p.add_argument('--select-mode', choices=['none', 'sharpest', 'coverage', 'hybrid'], default='none',
                   help='Select a subset of frames based on sharpness/coverage before alignment')
    p.add_argument('--select-count', type=int, default=0,
                   help='Target number of frames after selection (0 = use all)')
    return p


def parse_args():
    parser = _build_arg_parser()
    # First pass to see if a preset was provided
    early_args, _ = parser.parse_known_args()
    preset_path = _resolve_preset_path(getattr(early_args, 'preset', ''))
    if preset_path:
        try:
            with open(preset_path, 'r') as f:
                data = json.load(f)
            # Accept either top-level dict of args or {'params': {...}}
            params = data.get('params', data) if isinstance(data, dict) else {}
            if isinstance(params, dict):
                # Only set defaults for known destinations
                known_dests = {a.dest for a in parser._actions if hasattr(a, 'dest')}
                defaults = {k: v for k, v in params.items() if k in known_dests}
                if defaults:
                    parser.set_defaults(**defaults)
                    print(f"[preset] Loaded defaults from {preset_path} for: {sorted(defaults.keys())}")
        except Exception as e:
            print(f"[preset] Failed to load preset from {preset_path}: {e}")
    return parser.parse_args()


def _resolve_preset_path(preset_value: str) -> Optional[Path]:
    if not preset_value:
        return None
    # Special keyword: 'best'
    if preset_value.strip().lower() == 'best':
        cache_root = Path(os.environ.get('XDG_CACHE_HOME', Path.home() / '.cache')) / 'pokemon_binder_scanner'
        cand = [
            Path('presets') / 'best.json',
            Path('output') / 'benchmark' / 'best.json',
            cache_root / 'presets' / 'best.json',
        ]
        for p in cand:
            if p.exists():
                return p
        return cand[-1]  # fall back to default location even if missing
    p = Path(preset_value)
    return p


def ensure_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True)


def parse_crop(crop_str: str):
    if not crop_str:
        return None
    try:
        x, y, w, h = map(int, crop_str.split(','))
        return x, y, w, h
    except Exception:
        raise ValueError('Crop must be x,y,w,h')


def read_video_frames(video_path: str, frame_interval: float, max_frames: int, crop, save_dir: Optional[Path] = None):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = total_frames / fps if fps > 0 and total_frames > 0 else 0

    step = max(1, int(round(frame_interval * fps)))

    frames = []
    indices = range(0, total_frames if total_frames > 0 else 10**9, step)
    pbar = tqdm(indices, desc='Extracting frames', total=(total_frames // step) if total_frames else None)

    count = 0
    for idx in pbar:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if not ret:
            break
        if crop is not None:
            x, y, w, h = crop
            frame = frame[y:y+h, x:x+w]
        frames.append(frame)
        if save_dir is not None:
            cv2.imwrite(str(save_dir / f"raw_{idx:08d}.png"), frame)
        count += 1
        if max_frames and count >= max_frames:
            break

    cap.release()
    if len(frames) == 0:
        raise RuntimeError("No frames extracted. Check video path or parameters.")
    return frames


def align_frames(frames, save_dir: Optional[Path] = None):
    # Use ECC alignment to align each frame to the first frame (reference)
    ref = frames[0]
    ref_gray = cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY)
    sz = (ref.shape[1], ref.shape[0])

    # Affine transform (6 params). For pure translation, use MOTION_TRANSLATION.
    warp_mode = cv2.MOTION_AFFINE
    number_of_iterations = 100
    termination_eps = 1e-6
    criteria = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, number_of_iterations, termination_eps)

    aligned = [ref]
    ecc_scores = []
    for i in tqdm(range(1, len(frames)), desc='Aligning frames'):
        im = frames[i]
        im_gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
        warp_matrix = np.eye(2, 3, dtype=np.float32)
        try:
            cc, warp_matrix = cv2.findTransformECC(ref_gray, im_gray, warp_matrix, warp_mode, criteria, None, 5)
            im_aligned = cv2.warpAffine(im, warp_matrix, sz, flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)
            try:
                ecc_scores.append(float(cc))
            except Exception:
                pass
        except cv2.error:
            # Fallback: no alignment
            im_aligned = im
        aligned.append(im_aligned)
        if save_dir is not None:
            cv2.imwrite(str(save_dir / f"aligned_{i:05d}.png"), im_aligned)
    if ecc_scores:
        try:
            import statistics
            print(f"Alignment ECC corr — mean: {statistics.mean(ecc_scores):.4f}, median: {statistics.median(ecc_scores):.4f}")
        except Exception:
            pass
    return aligned


def stack_frames(frames, method: str):
    stack = np.stack(frames, axis=0).astype(np.float32)
    if method == 'median':
        img = np.median(stack, axis=0)
    else:
        img = np.mean(stack, axis=0)
    return np.clip(img, 0, 255).astype(np.uint8)


def resize_image(img, scale: float):
    if scale == 1.0:
        return img
    h, w = img.shape[:2]
    new_size = (int(round(w * scale)), int(round(h * scale)))
    return cv2.resize(img, new_size, interpolation=cv2.INTER_CUBIC)


def unsharp_mask(img, amount=0.4, radius=3):
    blurred = cv2.GaussianBlur(img, (0, 0), radius)
    sharp = cv2.addWeighted(img, 1 + amount, blurred, -amount, 0)
    return np.clip(sharp, 0, 255).astype(np.uint8)


def _gaussian_ksize(sigma: float) -> int:
    k = int(round(6 * max(0.1, sigma) + 1))
    return k if k % 2 == 1 else k + 1


def _to_float01(img: np.ndarray) -> np.ndarray:
    if img.dtype == np.uint8:
        return img.astype(np.float32) / 255.0
    imgf = img.astype(np.float32)
    m = imgf.max()
    return imgf / (m if m > 0 else 1.0)


def _to_uint8(img: np.ndarray) -> np.ndarray:
    return np.clip(np.round(img * 255.0), 0, 255).astype(np.uint8)


def _downsample(img: np.ndarray, scale: int) -> np.ndarray:
    h, w = img.shape[:2]
    return cv2.resize(img, (w // scale, h // scale), interpolation=cv2.INTER_AREA)


def _upsample(img: np.ndarray, scale: int) -> np.ndarray:
    h, w = img.shape[:2]
    return cv2.resize(img, (w * scale, h * scale), interpolation=cv2.INTER_CUBIC)


def _var_laplacian(img: np.ndarray) -> float:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _frac_part(v: float) -> float:
    # fractional part in [0,1)
    av = abs(v)
    return av - np.floor(av)


def estimate_sr_scale_from_shifts_and_sharpness(frames: list, shifts: list | None, max_scale: int = 4):
    """Heuristic: decide feasible SR scale using sub-pixel coverage and image sharpness.

    Returns (scale:int, info:dict). Scale is in [1..max_scale].
    """
    if not frames:
        return 1, {"reason": "no-frames"}
    try:
        max_scale = int(max(2, max_scale))
    except Exception:
        max_scale = 4

    # Sharpness via variance of Laplacian
    sharp = _var_laplacian(frames[0])
    if sharp >= 220:
        sharp_cap = 4
    elif sharp >= 140:
        sharp_cap = 3
    elif sharp >= 80:
        sharp_cap = 2
    else:
        sharp_cap = 1

    # If no shifts, rely on sharpness only
    if not shifts or len(shifts) != len(frames):
        return min(sharp_cap, max_scale), {"sharp": sharp, "reason": "no-shifts"}

    fracs = [(_frac_part(dx), _frac_part(dy)) for (dx, dy) in shifts]
    chosen = 1
    cov = {}
    # Try from high to low within [2..min(4,max_scale)]
    hi = min(max_scale, 4)
    for s in range(hi, 1, -1):
        bins_x = set()
        bins_y = set()
        for fx, fy in fracs:
            bins_x.add(int(np.floor(fx * s)))
            bins_y.add(int(np.floor(fy * s)))
        occ_x = len(bins_x) / float(s)
        occ_y = len(bins_y) / float(s)
        # Require at least half coverage per axis and enough frames
        enough_frames = len(frames) >= max(4, (s * s) // 2)
        if occ_x >= 0.5 and occ_y >= 0.5 and enough_frames:
            chosen = s
            cov = {"s": s, "occ_x": occ_x, "occ_y": occ_y, "frames": len(frames)}
            break
    chosen = min(chosen, sharp_cap)
    return chosen, {"sharp": sharp, **cov}


def _compute_sharpness_scores(frames: list) -> list:
    return [_var_laplacian(f) for f in frames]


def _frac_shifts_from_shifts(shifts: list) -> list:
    return [(_frac_part(dx), _frac_part(dy)) for (dx, dy) in shifts]


def _coverage_bins(fracs: list, s: int) -> set:
    # Use 2D bins (s x s) for fractional shifts
    bins = set()
    for fx, fy in fracs:
        bx = int(np.floor(fx * s))
        by = int(np.floor(fy * s))
        bins.add((min(max(bx, 0), s - 1), min(max(by, 0), s - 1)))
    return bins


def _coverage_gain(frac: tuple, current: set, s: int) -> int:
    bx = int(np.floor(frac[0] * s))
    by = int(np.floor(frac[1] * s))
    b = (min(max(bx, 0), s - 1), min(max(by, 0), s - 1))
    return 0 if b in current else 1


def select_frames_indices(frames: list, mode: str, count: int, upsample: int, target_scale: int) -> list:
    n = len(frames)
    if n == 0:
        return []
    if count <= 0 or count >= n:
        return list(range(n))
    # Always keep the first as reference
    sel = [0]
    remaining = list(range(1, n))
    sharp = _compute_sharpness_scores(frames)
    est_shifts = None
    fracs = None
    if mode in ('coverage', 'hybrid'):
        try:
            est_shifts = estimate_subpixel_shifts(frames, upsample)
            fracs = _frac_shifts_from_shifts(est_shifts)
        except Exception:
            fracs = [(0.0, 0.0)] * n
    if mode == 'sharpest':
        # Pick top-(count-1) by sharpness among remaining
        top = sorted(remaining, key=lambda i: sharp[i], reverse=True)[:max(0, count - 1)]
        sel.extend(top)
        sel.sort()
        return sel
    # Coverage or hybrid: greedy by marginal 2D bin coverage; tie-break by sharpness
    s = int(max(2, target_scale))
    covered = _coverage_bins([fracs[i] for i in sel] if fracs else [], s)
    while len(sel) < count and remaining:
        best_i = None
        best_gain = -1
        best_tiebreak = -1.0
        for i in remaining:
            gain = _coverage_gain(fracs[i], covered, s) if fracs else 0
            score = gain
            if mode == 'hybrid':
                # normalize sharpness across remaining to [0,1]
                vals = [sharp[j] for j in remaining]
                vmin, vmax = (min(vals), max(vals)) if vals else (0.0, 1.0)
                sh_norm = (sharp[i] - vmin) / (vmax - vmin + 1e-8)
                score = gain + 0.25 * sh_norm  # small preference for sharpness
            if score > best_tiebreak or (score == best_tiebreak and gain > best_gain):
                best_tiebreak = score
                best_gain = gain
                best_i = i
        if best_i is None:
            break
        remaining.remove(best_i)
        sel.append(best_i)
        if fracs:
            covered.add((int(np.floor(fracs[best_i][0] * s)), int(np.floor(fracs[best_i][1] * s))))
    sel.sort()
    return sel


def _psnr(a: np.ndarray, b: np.ndarray) -> float:
    a = a.astype(np.float32)
    b = b.astype(np.float32)
    mse = np.mean((a - b) ** 2)
    if mse <= 1e-12:
        return float('inf')
    return 20.0 * np.log10(255.0 / np.sqrt(mse))


def _gray_f32(img: np.ndarray) -> np.ndarray:
    if img.ndim == 2:
        g = img
    else:
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return g.astype(np.float32) / 255.0


def _hf_energy_ratio(img_hr: np.ndarray, scale: int) -> float:
    """Fraction of image power above LR Nyquist (0.5/scale cycles/pixel) up to HR Nyquist (0.5).
    Uses magnitude spectrum of grayscale image.
    """
    g = _gray_f32(img_hr)
    h, w = g.shape
    F = np.fft.fftshift(np.fft.fft2(g))
    mag2 = (np.abs(F) ** 2)
    yy, xx = np.mgrid[0:h, 0:w]
    cy, cx = (h - 1) / 2.0, (w - 1) / 2.0
    ry = (yy - cy) / max(1.0, h)
    rx = (xx - cx) / max(1.0, w)
    r = np.sqrt(rx * rx + ry * ry) * 2.0  # normalize so Nyquist ~ 0.5 at radius ~0.5
    # Define cutoffs in this normalized radius proxy
    lo = 0.5 / max(1, int(scale))  # LR Nyquist in HR grid
    hi = 0.5
    mask_hf = (r >= lo) & (r <= hi)
    tot = float(np.sum(mag2))
    if tot <= 0:
        return 0.0
    hf = float(np.sum(mag2[mask_hf]))
    return hf / tot


def _warp_translate(img: np.ndarray, dx: float, dy: float, out_size=None, border=cv2.BORDER_REFLECT) -> np.ndarray:
    h, w = img.shape[:2]
    if out_size is None:
        out_size = (w, h)
    M = np.array([[1.0, 0.0, dx], [0.0, 1.0, dy]], dtype=np.float32)
    return cv2.warpAffine(img, M, out_size, flags=cv2.INTER_LINEAR, borderMode=border)


def estimate_subpixel_shifts(frames: list, upsample_factor: int = 50) -> list:
    """Estimate (dx, dy) shifts (in LR pixels) of each frame relative to the first, using phase correlation.
    Returns a list of tuples, first element (0,0)."""
    try:
        from skimage.registration import phase_cross_correlation
    except Exception:
        print("[align] scikit-image not available; using zero shifts")
        return [(0.0, 0.0)] * len(frames)
    ref = cv2.cvtColor(frames[0], cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    shifts = [(0.0, 0.0)]
    for i in range(1, len(frames)):
        im = cv2.cvtColor(frames[i], cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
        shift, error, _ = phase_cross_correlation(ref, im, upsample_factor=max(1, int(upsample_factor)))
        dy, dx = float(shift[0]), float(shift[1])
        shifts.append((dx, dy))
    return shifts


def _dct2_channels(x: np.ndarray) -> np.ndarray:
    # Apply 2D DCT per channel
    if x.ndim == 2:
        return cv2.dct(x)
    chans = cv2.split(x)
    dcts = [cv2.dct(c) for c in chans]
    return cv2.merge(dcts)


def _idct2_channels(X: np.ndarray) -> np.ndarray:
    if X.ndim == 2:
        return cv2.idct(X)
    chans = cv2.split(X)
    imgs = [cv2.idct(C) for C in chans]
    return cv2.merge(imgs)


def _soft_threshold(arr: np.ndarray, t: float) -> np.ndarray:
    return np.sign(arr) * np.maximum(np.abs(arr) - t, 0.0)


def apply_fista_dct_single(lr_img: np.ndarray, scale: int, iterations: int, step: float, lam: float, blur_sigma: float) -> np.ndarray:
    # Initialize HR with bicubic upsample
    x = _to_float01(cv2.resize(lr_img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC))
    y = _to_float01(lr_img)
    ksize = _gaussian_ksize(blur_sigma)
    t_k = 1.0
    v = x.copy()
    for _ in range(max(1, iterations)):
        # Gradient of data term at v
        vb = cv2.GaussianBlur(v, (ksize, ksize), blur_sigma)
        y_hat = _downsample(vb, scale)
        r = y - y_hat
        grad = -cv2.GaussianBlur(_upsample(r, scale), (ksize, ksize), blur_sigma)
        z = v - step * grad
        # DCT soft-threshold
        Z = _dct2_channels(z)
        Zt = _soft_threshold(Z, step * lam)
        x_new = _idct2_channels(Zt)
        x_new = np.clip(x_new, 0.0, 1.0)
        t_new = 0.5 * (1 + np.sqrt(1 + 4 * t_k * t_k))
        v = x_new + ((t_k - 1) / t_new) * (x_new - x)
        x = x_new
        t_k = t_new
    return _to_uint8(x)


def apply_fista_dct_multi(aligned_frames: list, init_hr: np.ndarray, scale: int, iterations: int, step: float, lam: float, blur_sigma: float) -> np.ndarray:
    x = _to_float01(init_hr)
    ys = [_to_float01(f) for f in aligned_frames]
    ksize = _gaussian_ksize(blur_sigma)
    t_k = 1.0
    v = x.copy()
    for _ in range(max(1, iterations)):
        # Accumulate gradient over frames
        acc = np.zeros_like(v, dtype=np.float32)
        for y in ys:
            vb = cv2.GaussianBlur(v, (ksize, ksize), blur_sigma)
            y_hat = _downsample(vb, scale)
            r = y - y_hat
            acc += -cv2.GaussianBlur(_upsample(r, scale), (ksize, ksize), blur_sigma)
        acc /= max(1, len(ys))
        z = v - step * acc
        Z = _dct2_channels(z)
        Zt = _soft_threshold(Z, step * lam)
        x_new = _idct2_channels(Zt)
        x_new = np.clip(x_new, 0.0, 1.0)
        t_new = 0.5 * (1 + np.sqrt(1 + 4 * t_k * t_k))
        v = x_new + ((t_k - 1) / t_new) * (x_new - x)
        x = x_new
        t_k = t_new
    return _to_uint8(x)


def apply_fista_dct_multi_shifts(lr_frames: list, shifts: list, init_hr: np.ndarray, scale: int, iterations: int, step: float, lam: float, blur_sigma: float) -> np.ndarray:
    x = _to_float01(init_hr)
    ys = [_to_float01(f) for f in lr_frames]
    ksize = _gaussian_ksize(blur_sigma)
    t_k = 1.0
    v = x.copy()
    for _ in range(max(1, iterations)):
        acc = np.zeros_like(v, dtype=np.float32)
        for y, (dx_lr, dy_lr) in zip(ys, shifts):
            v_shift = _warp_translate(v, -dx_lr * scale, -dy_lr * scale)
            vb = cv2.GaussianBlur(v_shift, (ksize, ksize), blur_sigma)
            y_hat = _downsample(vb, scale)
            r = y - y_hat
            back = -cv2.GaussianBlur(_upsample(r, scale), (ksize, ksize), blur_sigma)
            acc += _warp_translate(back, dx_lr * scale, dy_lr * scale)
        acc /= max(1, len(ys))
        z = v - step * acc
        Z = _dct2_channels(z)
        Zt = _soft_threshold(Z, step * lam)
        x_new = _idct2_channels(Zt)
        x_new = np.clip(x_new, 0.0, 1.0)
        t_new = 0.5 * (1 + np.sqrt(1 + 4 * t_k * t_k))
        v = x_new + ((t_k - 1) / t_new) * (x_new - x)
        x = x_new
        t_k = t_new
    return _to_uint8(x)


def apply_cs_super_resolution(img: np.ndarray, scale: int, iterations: int, alpha: float, tv_weight: float, blur_sigma: float) -> np.ndarray:
    # Compressed-sensing inspired: iterative back-projection with TV prior (plug-and-play)
    # Operate in float [0,1]
    x = _to_float01(cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC))
    y = _to_float01(img)

    ksize = _gaussian_ksize(blur_sigma)
    # Try importing TV denoiser; otherwise skip TV
    try:
        from skimage.restoration import denoise_tv_chambolle
        have_tv = True
    except Exception:
        have_tv = False

    for _ in range(max(1, iterations)):
        # Forward model: blur then downsample
        xb = cv2.GaussianBlur(x, (ksize, ksize), blur_sigma)
        y_hat = _downsample(xb, scale)
        # Residual in LR space
        r = y - y_hat
        # Back-project: upsample residual and blur (approximate transpose)
        rb = cv2.GaussianBlur(_upsample(r, scale), (ksize, ksize), blur_sigma)
        x = x + alpha * rb
        # TV denoising as proximal step
        if have_tv and tv_weight > 0:
            # channel_axis=-1 for skimage >= 0.19
            try:
                x = denoise_tv_chambolle(x, weight=tv_weight, channel_axis=-1)
            except TypeError:
                # Fallback for older versions
                x = denoise_tv_chambolle(x, weight=tv_weight, multichannel=True)
        # Clamp to valid range
        x = np.clip(x, 0.0, 1.0)

    return _to_uint8(x)


def apply_cs_super_resolution_multi(aligned_frames: list, init_hr: np.ndarray, scale: int, iterations: int, alpha: float, tv_weight: float, blur_sigma: float) -> np.ndarray:
    # Multi-frame IBP+TV: use multiple aligned LR frames to guide HR estimate.
    # aligned_frames: list of aligned LR frames (uint8 BGR), same size as init_hr downsampled by 'scale'.
    x = _to_float01(init_hr)
    lr_frames = [_to_float01(f) for f in aligned_frames]

    ksize = _gaussian_ksize(blur_sigma)
    try:
        from skimage.restoration import denoise_tv_chambolle
        have_tv = True
    except Exception:
        have_tv = False

    for _ in range(max(1, iterations)):
        # For each LR frame, compute residual via forward model and accumulate back-projection
        acc = np.zeros_like(x, dtype=np.float32)
        for y in lr_frames:
            xb = cv2.GaussianBlur(x, (ksize, ksize), blur_sigma)
            y_hat = _downsample(xb, scale)
            r = y - y_hat
            rb = cv2.GaussianBlur(_upsample(r, scale), (ksize, ksize), blur_sigma)
            acc += rb
        acc /= max(1, len(lr_frames))
        x = x + alpha * acc
        if have_tv and tv_weight > 0:
            try:
                x = denoise_tv_chambolle(x, weight=tv_weight, channel_axis=-1)
            except TypeError:
                x = denoise_tv_chambolle(x, weight=tv_weight, multichannel=True)
        x = np.clip(x, 0.0, 1.0)

    return _to_uint8(x)


def apply_cs_super_resolution_multi_shifts(lr_frames: list, shifts: list, init_hr: np.ndarray, scale: int, iterations: int, alpha: float, tv_weight: float, blur_sigma: float) -> np.ndarray:
    x = _to_float01(init_hr)
    ys = [_to_float01(f) for f in lr_frames]
    ksize = _gaussian_ksize(blur_sigma)
    try:
        from skimage.restoration import denoise_tv_chambolle
        have_tv = True
    except Exception:
        have_tv = False
    for _ in range(max(1, iterations)):
        acc = np.zeros_like(x, dtype=np.float32)
        for y, (dx_lr, dy_lr) in zip(ys, shifts):
            x_shift = _warp_translate(x, -dx_lr * scale, -dy_lr * scale)
            xb = cv2.GaussianBlur(x_shift, (ksize, ksize), blur_sigma)
            y_hat = _downsample(xb, scale)
            r = y - y_hat
            rb = cv2.GaussianBlur(_upsample(r, scale), (ksize, ksize), blur_sigma)
            acc += _warp_translate(rb, dx_lr * scale, dy_lr * scale)
        acc /= max(1, len(ys))
        x = x + alpha * acc
        if have_tv and tv_weight > 0:
            try:
                x = denoise_tv_chambolle(x, weight=tv_weight, channel_axis=-1)
            except TypeError:
                x = denoise_tv_chambolle(x, weight=tv_weight, multichannel=True)
        x = np.clip(x, 0.0, 1.0)
    return _to_uint8(x)


def _default_sr_model_filename(model: str, scale: int) -> str:
    # Model filenames are typically capitalized, e.g., ESPCN_x2.pb, EDSR_x4.pb, etc.
    name_map = {
        'espcn': 'ESPCN',
        'edsr': 'EDSR',
        'fsrcnn': 'FSRCNN',
        'lapsrn': 'LapSRN',
    }
    base = name_map.get(model, model.upper())
    return f"{base}_x{scale}.pb"


def _default_sr_model_path(model: str, scale: int) -> Path:
    # Store under user cache to avoid workspace permission issues
    cache_dir = Path.home() / '.cache' / 'pokemon_binder_scanner' / 'superres'
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / _default_sr_model_filename(model, scale)


def _sr_model_url_candidates(model: str, scale: int):
    filename = _default_sr_model_filename(model, scale)
    # Candidate sources (some may be unavailable over time). We'll try in order.
    return [
        # OpenCV contrib sample paths (may not host all models)
        f"https://github.com/opencv/opencv_contrib/raw/4.x/modules/dnn_superres/dnn_superres/samples/{filename}",
        # Saafke TensorFlow repos (commonly referenced by OpenCV docs/examples)
        f"https://github.com/Saafke/ESPCN_Tensorflow/raw/master/models/{filename}",
        f"https://github.com/Saafke/EDSR_Tensorflow/raw/master/models/{filename}",
        f"https://github.com/Saafke/FSRCNN_Tensorflow/raw/master/models/{filename}",
        f"https://github.com/Saafke/LapSRN_Tensorflow/raw/master/models/{filename}",
    ]


def apply_super_resolution(img: np.ndarray, model: str, scale: int, model_path: Optional[str], auto_download: bool) -> np.ndarray:
    if model == 'off':
        return img
    if model == 'cs':
        # This path should not be used; apply_cs_super_resolution is called directly from main
        return img

    # Validate supported scales
    valid_scales = {2, 3, 4}
    if model == 'lapsrn':
        valid_scales = {2, 4, 8}
    if scale not in valid_scales:
        raise ValueError(f"Scale {scale} not supported for {model}. Choose from {sorted(valid_scales)}")

    # Resolve model path
    mpath = Path(model_path) if model_path else _default_sr_model_path(model, scale)
    if not mpath.exists():
        if auto_download:
            mpath.parent.mkdir(parents=True, exist_ok=True)
            last_err = None
            for url in _sr_model_url_candidates(model, scale):
                try:
                    urlretrieve(url, str(mpath))
                    print(f"Downloaded SR model to: {mpath}")
                    break
                except Exception as e:
                    last_err = e
                    continue
            if not mpath.exists():
                print(f"[superres] Failed to download model {model} x{scale} from known sources; skipping SR. Last error: {last_err}")
                return img
        else:
            print(f"[superres] Model file not found: {mpath}. Provide --superres-model-path or enable --superres-auto-download. Skipping SR.")
            return img

    # Create SR engine
    try:
        sr = cv2.dnn_superres.DnnSuperResImpl_create()
    except AttributeError:
        raise RuntimeError("OpenCV was built without dnn_superres module. Ensure opencv-contrib-python is installed.")

    sr.readModel(str(mpath))
    sr.setModel(model, scale)
    # dnn_superres expects BGR uint8 image
    out = sr.upsample(img)
    return np.clip(out, 0, 255).astype(np.uint8)


def main():
    args = parse_args()
    crop = parse_crop(args.crop)

    tmp_dir = Path('output/steps') if args.save_steps else None
    if tmp_dir is not None:
        ensure_dir(tmp_dir)

    frames = read_video_frames(args.video, args.frame_interval, args.max_frames, crop, tmp_dir)
    # Optional frame selection before alignment/stacking
    if args.select_mode != 'none' and len(frames) > 1:
        # Choose a target scale for coverage: use auto-estimate if enabled, else desired scale if multi-frame SR, else 2
        s_target = 2
        try:
            if args.superres_auto_scale:
                try:
                    est_shifts = estimate_subpixel_shifts(frames, args.align_upsampling)
                except Exception:
                    est_shifts = None
                s_est, _ = estimate_sr_scale_from_shifts_and_sharpness(frames, est_shifts, args.max_auto_scale)
                if s_est >= 2:
                    s_target = int(s_est)
            elif args.superres_model in ('cs-multi', 'fista-dct-multi'):
                s_target = int(max(2, args.superres_scale))
        except Exception:
            pass
        sel_count = int(args.select_count) if args.select_count > 0 else len(frames)
        idx = select_frames_indices(frames, args.select_mode, sel_count, args.align_upsampling, s_target)
        if idx and len(idx) < len(frames):
            print(f"[select] Using {len(idx)}/{len(frames)} frames (mode={args.select_mode}, target_scale=x{s_target})")
            frames = [frames[i] for i in idx]
    aligned = align_frames(frames, tmp_dir)

    stacked = stack_frames(aligned, args.stack)

    # Super-resolution (if requested)
    out_img = stacked
    used_sr_scale = 1
    if args.superres_model and args.superres_model != 'off':
        if args.superres_model == 'cs':
            # Require integer scale >= 2
            s = int(max(2, args.superres_scale))
            if args.superres_auto_scale:
                s_est, info = estimate_sr_scale_from_shifts_and_sharpness(frames, None, args.max_auto_scale)
                if s_est >= 2:
                    print(f"[auto-scale] Selected x{s_est} (sharp={info.get('sharp', 0):.1f}) for cs")
                    s = s_est
            used_sr_scale = s
            out_img = apply_cs_super_resolution(
                out_img,
                scale=s,
                iterations=args.cs_iterations,
                alpha=args.cs_alpha,
                tv_weight=args.cs_tv_weight,
                blur_sigma=args.cs_blur_sigma,
            )
        elif args.superres_model == 'cs-multi':
            s = int(max(2, args.superres_scale))
            # Initialize HR from bicubic upsample of stacked
            if args.superres_auto_scale:
                try:
                    # Estimate shifts even if we later choose not to use them in reconstruction
                    est_shifts = estimate_subpixel_shifts(frames, args.align_upsampling)
                except Exception:
                    est_shifts = None
                s_est, info = estimate_sr_scale_from_shifts_and_sharpness(frames, est_shifts, args.max_auto_scale)
                if s_est >= 2:
                    print(f"[auto-scale] Selected x{s_est} (sharp={info.get('sharp', 0):.1f}, occ_x={info.get('occ_x', 0):.2f}, occ_y={info.get('occ_y', 0):.2f}) for cs-multi")
                    s = s_est
            used_sr_scale = s
            init_hr = cv2.resize(stacked, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
            if args.align_subpixel:
                shifts = estimate_subpixel_shifts(frames, args.align_upsampling)
                out_img = apply_cs_super_resolution_multi_shifts(
                    lr_frames=frames,
                    shifts=shifts,
                    init_hr=init_hr,
                    scale=s,
                    iterations=args.cs_iterations,
                    alpha=args.cs_alpha,
                    tv_weight=args.cs_tv_weight,
                    blur_sigma=args.cs_blur_sigma,
                )
            else:
                out_img = apply_cs_super_resolution_multi(
                    aligned_frames=aligned,
                    init_hr=init_hr,
                    scale=s,
                    iterations=args.cs_iterations,
                    alpha=args.cs_alpha,
                    tv_weight=args.cs_tv_weight,
                    blur_sigma=args.cs_blur_sigma,
                )
        elif args.superres_model == 'fista-dct':
            s = int(max(2, args.superres_scale))
            if args.superres_auto_scale:
                s_est, info = estimate_sr_scale_from_shifts_and_sharpness(frames, None, args.max_auto_scale)
                if s_est >= 2:
                    print(f"[auto-scale] Selected x{s_est} (sharp={info.get('sharp', 0):.1f}) for fista-dct")
                    s = s_est
            used_sr_scale = s
            out_img = apply_fista_dct_single(
                lr_img=stacked,
                scale=s,
                iterations=args.cs_iterations,
                step=args.fista_step,
                lam=args.dct_lambda,
                blur_sigma=args.cs_blur_sigma,
            )
        elif args.superres_model == 'fista-dct-multi':
            s = int(max(2, args.superres_scale))
            if args.superres_auto_scale:
                try:
                    est_shifts = estimate_subpixel_shifts(frames, args.align_upsampling)
                except Exception:
                    est_shifts = None
                s_est, info = estimate_sr_scale_from_shifts_and_sharpness(frames, est_shifts, args.max_auto_scale)
                if s_est >= 2:
                    print(f"[auto-scale] Selected x{s_est} (sharp={info.get('sharp', 0):.1f}, occ_x={info.get('occ_x', 0):.2f}, occ_y={info.get('occ_y', 0):.2f}) for fista-dct-multi")
                    s = s_est
            used_sr_scale = s
            init_hr = cv2.resize(stacked, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
            if args.align_subpixel:
                shifts = estimate_subpixel_shifts(frames, args.align_upsampling)
                out_img = apply_fista_dct_multi_shifts(
                    lr_frames=frames,
                    shifts=shifts,
                    init_hr=init_hr,
                    scale=s,
                    iterations=args.cs_iterations,
                    step=args.fista_step,
                    lam=args.dct_lambda,
                    blur_sigma=args.cs_blur_sigma,
                )
            else:
                out_img = apply_fista_dct_multi(
                    aligned_frames=aligned,
                    init_hr=init_hr,
                    scale=s,
                    iterations=args.cs_iterations,
                    step=args.fista_step,
                    lam=args.dct_lambda,
                    blur_sigma=args.cs_blur_sigma,
                )
        else:
            # Optionally auto-pick a model scale within the model's supported set
            model_scale = int(args.superres_scale)
            if args.superres_auto_scale:
                try:
                    est_shifts = estimate_subpixel_shifts(frames, args.align_upsampling)
                except Exception:
                    est_shifts = None
                s_est, info = estimate_sr_scale_from_shifts_and_sharpness(frames, est_shifts, args.max_auto_scale)
                # Constrain to valid scales per model
                valid = {2, 3, 4}
                if args.superres_model == 'lapsrn':
                    valid = {2, 4, 8}
                # Pick the largest valid <= estimate; fallback to min(valid)
                candidates = sorted([v for v in valid if v <= max(2, s_est)])
                model_scale = candidates[-1] if candidates else min(valid)
                print(f"[auto-scale] Selected x{model_scale} for model {args.superres_model} (est={s_est}, sharp={info.get('sharp', 0):.1f})")
            used_sr_scale = int(model_scale)
            out_img = apply_super_resolution(
                out_img,
                model=args.superres_model,
                scale=model_scale,
                model_path=args.superres_model_path,
                auto_download=bool(args.superres_auto_download),
            )

    # Optional additional resize (non-integer scales etc.)
    out_img = resize_image(out_img, args.resize)

    if args.sharpen:
        out_img = unsharp_mask(out_img)

    out_path = Path(args.out)
    ensure_dir(out_path.parent)

    # Save 16-bit TIFF if requested
    ext = out_path.suffix.lower()
    if ext in ['.tif', '.tiff']:
        # Convert to 16-bit using simple scale to retain more precision after averaging
        out16 = np.clip(out_img.astype(np.float32) / 255.0 * 65535.0, 0, 65535).astype(np.uint16)
        cv2.imwrite(str(out_path), out16)
    else:
        cv2.imwrite(str(out_path), out_img)

    print(f"Saved: {out_path}")

    # Metrics report (optional)
    if args.report_metrics:
        metrics = {}
        # Sharpness of reference frame
        try:
            metrics['sharpness_var_laplacian'] = _var_laplacian(frames[0])
        except Exception:
            pass
        # Sub-pixel coverage for s=2..min(4,max-auto)
        try:
            shifts = estimate_subpixel_shifts(frames, args.align_upsampling)
            cov = {}
            for s in range(2, min(4, int(max(2, args.max_auto_scale))) + 1):
                fracs = []
                for dx, dy in shifts:
                    fx = abs(dx) - np.floor(abs(dx))
                    fy = abs(dy) - np.floor(abs(dy))
                    fracs.append((fx, fy))
                bins_x = set(int(np.floor(fx * s)) for fx, _ in fracs)
                bins_y = set(int(np.floor(fy * s)) for _, fy in fracs)
                cov[f'x{s}'] = {
                    'occ_x': len(bins_x) / float(s),
                    'occ_y': len(bins_y) / float(s),
                    'frames': len(frames),
                }
            metrics['shift_coverage'] = cov
        except Exception:
            pass
        # Forward-model consistency (if SR applied)
        try:
            if used_sr_scale and used_sr_scale > 1:
                ksize = _gaussian_ksize(args.cs_blur_sigma)
                sim = cv2.GaussianBlur(out_img, (ksize, ksize), args.cs_blur_sigma)
                sim_lr = _downsample(sim, used_sr_scale)
                base_lr = stacked
                # Resize to match in case of stack method differences
                if sim_lr.shape != base_lr.shape:
                    base_lr = cv2.resize(base_lr, (sim_lr.shape[1], sim_lr.shape[0]), interpolation=cv2.INTER_AREA)
                metrics['consistency_psnr'] = _psnr(sim_lr, base_lr)
                metrics['consistency_l2'] = float(np.mean((sim_lr.astype(np.float32) - base_lr.astype(np.float32)) ** 2))
        except Exception:
            pass
        # High-frequency energy ratio (and relative to bicubic baseline)
        try:
            if used_sr_scale and used_sr_scale > 1:
                hf_sr = _hf_energy_ratio(out_img, used_sr_scale)
                bic = cv2.resize(stacked, None, fx=used_sr_scale, fy=used_sr_scale, interpolation=cv2.INTER_CUBIC)
                hf_bic = _hf_energy_ratio(bic, used_sr_scale)
                metrics['hf_energy_ratio'] = hf_sr
                metrics['hf_energy_ratio_bicubic'] = hf_bic
                metrics['hf_gain_vs_bicubic'] = (hf_sr / hf_bic) if hf_bic > 1e-12 else None
                metrics['sr_scale_used'] = int(used_sr_scale)
        except Exception:
            pass
        # Write JSON
        try:
            def _py(obj):
                if isinstance(obj, (np.floating,)):
                    return float(obj)
                if isinstance(obj, (np.integer,)):
                    return int(obj)
                return obj
            metrics = json.loads(json.dumps(metrics, default=_py))
            mpath = Path(args.metrics_path) if args.metrics_path else out_path.with_suffix('.json')
            with open(mpath, 'w') as f:
                json.dump(metrics, f, indent=2)
            print(f"Metrics written: {mpath}")
        except Exception as e:
            print(f"[metrics] Failed to write metrics JSON: {e}")


if __name__ == '__main__':
    main()

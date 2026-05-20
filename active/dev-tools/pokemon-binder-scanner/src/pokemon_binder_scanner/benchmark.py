import argparse
import json
import os
from pathlib import Path
import time
import random

import numpy as np

import cv2

from .pipeline import (
    parse_crop,
    read_video_frames,
    align_frames,
    stack_frames,
    apply_cs_super_resolution,
    apply_cs_super_resolution_multi,
    apply_cs_super_resolution_multi_shifts,
    apply_fista_dct_single,
    apply_fista_dct_multi,
    apply_fista_dct_multi_shifts,
    apply_super_resolution,
    estimate_subpixel_shifts,
    estimate_sr_scale_from_shifts_and_sharpness,
    _var_laplacian,
    _gaussian_ksize,
    _downsample,
    _psnr,
    _hf_energy_ratio,
    select_frames_indices,
)


def score_from_metrics(m: dict, w: dict) -> float:
    # Normalize and combine metrics with weights
    psnr = float(m.get('consistency_psnr', 0.0))
    # Normalize PSNR ~ [20,45]
    psnr_n = max(0.0, min(1.0, (psnr - 20.0) / (45.0 - 20.0)))

    hf_gain = float(m.get('hf_gain_vs_bicubic', 1.0) or 1.0)
    # Normalize hf gain ~ [1.0, 2.0]
    hf_n = max(0.0, min(1.0, (hf_gain - 1.0) / 1.0))

    sharp = float(m.get('sharpness_var_laplacian', 0.0))
    # Normalize sharpness ~ [50,300]
    sharp_n = max(0.0, min(1.0, (sharp - 50.0) / (300.0 - 50.0)))

    cov = m.get('shift_coverage', {})
    cov3 = cov.get('x3', {})
    cov4 = cov.get('x4', {})
    cov3_n = float(min(cov3.get('occ_x', 0.0), cov3.get('occ_y', 0.0)))
    cov4_n = float(min(cov4.get('occ_x', 0.0), cov4.get('occ_y', 0.0)))

    # Overfit penalty: if hf_n is high but PSNR drops, penalize
    penalty = 0.0
    if hf_n > 0.5 and psnr_n < 0.3:
        penalty += (hf_n - 0.5) * 0.5

    return (
        w['psnr'] * psnr_n
        + w['hf'] * hf_n
        + w['sharp'] * sharp_n
        + w['cov3'] * cov3_n
        + w['cov4'] * cov4_n
        - w['penalty'] * penalty
    )


def run_once(video: str, params: dict) -> tuple[float, dict, dict]:
    # Prepare basic params
    crop = parse_crop(params.get('crop', '') or '')
    frame_interval = float(params.get('frame_interval', 0.25))
    max_frames = int(params.get('max_frames', 120) or 0)
    stack = params.get('stack', 'mean')

    frames = read_video_frames(video, frame_interval, max_frames, crop, save_dir=None)

    # Frame selection
    select_mode = params.get('select_mode', 'none')
    select_count = int(params.get('select_count', 0))
    if select_mode != 'none' and len(frames) > 1:
        # pick a target scale for coverage
        s_target = int(max(2, params.get('superres_scale', 2)))
        idx = select_frames_indices(frames, select_mode, select_count if select_count > 0 else len(frames), int(params.get('align_upsampling', 50)), s_target)
        frames = [frames[i] for i in idx]

    # Align and stack
    aligned = align_frames(frames, save_dir=None)
    stacked = stack_frames(aligned, stack)

    # SR params
    model = params.get('superres_model', 'fista-dct-multi')
    s = int(max(2, params.get('superres_scale', 2)))
    auto_scale = bool(params.get('superres_auto_scale', True))
    align_subpixel = bool(params.get('align_subpixel', True))
    align_upsampling = int(params.get('align_upsampling', 50))
    cs_iterations = int(params.get('cs_iterations', 8))
    cs_alpha = float(params.get('cs_alpha', 0.7))
    cs_tv_weight = float(params.get('cs_tv_weight', 0.1))
    cs_blur_sigma = float(params.get('cs_blur_sigma', 1.1))
    fista_step = float(params.get('fista_step', 0.5))
    dct_lambda = float(params.get('dct_lambda', 0.01))

    out_img = stacked
    used_sr_scale = 1
    if model != 'off':
        if model == 'cs':
            if auto_scale:
                s_est, _ = estimate_sr_scale_from_shifts_and_sharpness(frames, None, int(params.get('max_auto_scale', 4)))
                if s_est >= 2:
                    s = int(s_est)
            out_img = apply_cs_super_resolution(out_img, s, cs_iterations, cs_alpha, cs_tv_weight, cs_blur_sigma)
            used_sr_scale = s
        elif model == 'cs-multi':
            if auto_scale:
                try:
                    est_shifts = estimate_subpixel_shifts(frames, align_upsampling)
                except Exception:
                    est_shifts = None
                s_est, _ = estimate_sr_scale_from_shifts_and_sharpness(frames, est_shifts, int(params.get('max_auto_scale', 4)))
                if s_est >= 2:
                    s = int(s_est)
            init_hr = cv2.resize(stacked, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
            if align_subpixel:
                shifts = estimate_subpixel_shifts(frames, align_upsampling)
                out_img = apply_cs_super_resolution_multi_shifts(frames, shifts, init_hr, s, cs_iterations, cs_alpha, cs_tv_weight, cs_blur_sigma)
            else:
                out_img = apply_cs_super_resolution_multi(aligned, init_hr, s, cs_iterations, cs_alpha, cs_tv_weight, cs_blur_sigma)
            used_sr_scale = s
        elif model == 'fista-dct':
            if auto_scale:
                s_est, _ = estimate_sr_scale_from_shifts_and_sharpness(frames, None, int(params.get('max_auto_scale', 4)))
                if s_est >= 2:
                    s = int(s_est)
            out_img = apply_fista_dct_single(stacked, s, cs_iterations, fista_step, dct_lambda, cs_blur_sigma)
            used_sr_scale = s
        elif model == 'fista-dct-multi':
            if auto_scale:
                try:
                    est_shifts = estimate_subpixel_shifts(frames, align_upsampling)
                except Exception:
                    est_shifts = None
                s_est, _ = estimate_sr_scale_from_shifts_and_sharpness(frames, est_shifts, int(params.get('max_auto_scale', 4)))
                if s_est >= 2:
                    s = int(s_est)
            init_hr = cv2.resize(stacked, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
            if align_subpixel:
                shifts = estimate_subpixel_shifts(frames, align_upsampling)
                out_img = apply_fista_dct_multi_shifts(frames, shifts, init_hr, s, cs_iterations, fista_step, dct_lambda, cs_blur_sigma)
            else:
                out_img = apply_fista_dct_multi(aligned, init_hr, s, cs_iterations, fista_step, dct_lambda, cs_blur_sigma)
            used_sr_scale = s
        else:
            # dnn models
            out_img = apply_super_resolution(out_img, model, s, model_path=params.get('superres_model_path', ''), auto_download=True)
            used_sr_scale = s

    # Build metrics similar to pipeline main()
    metrics = {}
    try:
        metrics['sharpness_var_laplacian'] = _var_laplacian(frames[0])
    except Exception:
        pass
    try:
        shifts = estimate_subpixel_shifts(frames, align_upsampling)
        cov = {}
        for ss in range(2, 5):
            fracs = []
            for dx, dy in shifts:
                fx = abs(dx) - np.floor(abs(dx))
                fy = abs(dy) - np.floor(abs(dy))
                fracs.append((fx, fy))
            bins_x = set(int(np.floor(fx * ss)) for fx, _ in fracs)
            bins_y = set(int(np.floor(fy * ss)) for _, fy in fracs)
            cov[f'x{ss}'] = {
                'occ_x': len(bins_x) / float(ss),
                'occ_y': len(bins_y) / float(ss),
                'frames': len(frames),
            }
        metrics['shift_coverage'] = cov
    except Exception:
        pass
    try:
        if used_sr_scale and used_sr_scale > 1:
            ksize = _gaussian_ksize(cs_blur_sigma)
            sim = cv2.GaussianBlur(out_img, (ksize, ksize), cs_blur_sigma)
            sim_lr = _downsample(sim, used_sr_scale)
            base_lr = stacked
            if sim_lr.shape != base_lr.shape:
                base_lr = cv2.resize(base_lr, (sim_lr.shape[1], sim_lr.shape[0]), interpolation=cv2.INTER_AREA)
            metrics['consistency_psnr'] = _psnr(sim_lr, base_lr)
            metrics['consistency_l2'] = float(np.mean((sim_lr.astype(np.float32) - base_lr.astype(np.float32)) ** 2))
    except Exception:
        pass
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

    return 0.0, metrics, {'out_img': out_img}


def make_search_space(rng: random.Random, mode: str = 'wide') -> dict:
    # Provide ranges; sampler will pick concrete values
    return {
        'frame_interval': (0.05, 0.5),
        'max_frames': (30, 240),
        'stack': ['mean', 'median'],
        'select_mode': ['none', 'sharpest', 'coverage', 'hybrid'],
        'select_count': (20, 150),
        'superres_model': ['fista-dct-multi', 'cs-multi'],
        'superres_scale': (2, 4),
        'superres_auto_scale': [True, False],
        'align_subpixel': [True, False],
        'align_upsampling': (10, 100),
        'cs_iterations': (5, 18),
        'cs_alpha': (0.4, 1.0),
        'cs_tv_weight': (0.0, 0.2),
        'cs_blur_sigma': (0.6, 2.0),
        'fista_step': (0.2, 1.0),
        'dct_lambda': (0.005, 0.05),
        'max_auto_scale': (2, 4),
    }


def sample_params(rng: random.Random, space: dict) -> dict:
    p = {}
    for k, v in space.items():
        if isinstance(v, tuple) and len(v) == 2:
            lo, hi = v
            if isinstance(lo, int) and isinstance(hi, int):
                p[k] = rng.randint(lo, hi)
            else:
                p[k] = float(rng.uniform(lo, hi))
        elif isinstance(v, list):
            p[k] = rng.choice(v)
        else:
            p[k] = v
    # Ensure int constraints
    p['superres_scale'] = int(round(p['superres_scale']))
    p['select_count'] = int(p['select_count'])
    p['max_auto_scale'] = int(p['max_auto_scale'])
    return p


def objective_optuna(trial, video: str, weights: dict):
    # Define optuna search space similar to random
    frame_interval = trial.suggest_float('frame_interval', 0.05, 0.5)
    max_frames = trial.suggest_int('max_frames', 30, 240)
    stack = trial.suggest_categorical('stack', ['mean', 'median'])
    select_mode = trial.suggest_categorical('select_mode', ['none', 'sharpest', 'coverage', 'hybrid'])
    select_count = trial.suggest_int('select_count', 20, 150)
    superres_model = trial.suggest_categorical('superres_model', ['fista-dct-multi', 'cs-multi'])
    superres_scale = trial.suggest_int('superres_scale', 2, 4)
    superres_auto_scale = trial.suggest_categorical('superres_auto_scale', [True, False])
    align_subpixel = trial.suggest_categorical('align_subpixel', [True, False])
    align_upsampling = trial.suggest_int('align_upsampling', 10, 100)
    cs_iterations = trial.suggest_int('cs_iterations', 5, 18)
    cs_alpha = trial.suggest_float('cs_alpha', 0.4, 1.0)
    cs_tv_weight = trial.suggest_float('cs_tv_weight', 0.0, 0.2)
    cs_blur_sigma = trial.suggest_float('cs_blur_sigma', 0.6, 2.0)
    fista_step = trial.suggest_float('fista_step', 0.2, 1.0)
    dct_lambda = trial.suggest_float('dct_lambda', 0.005, 0.05)
    max_auto_scale = trial.suggest_int('max_auto_scale', 2, 4)

    params = {
        'frame_interval': frame_interval,
        'max_frames': max_frames,
        'stack': stack,
        'select_mode': select_mode,
        'select_count': select_count,
        'superres_model': superres_model,
        'superres_scale': superres_scale,
        'superres_auto_scale': superres_auto_scale,
        'align_subpixel': align_subpixel,
        'align_upsampling': align_upsampling,
        'cs_iterations': cs_iterations,
        'cs_alpha': cs_alpha,
        'cs_tv_weight': cs_tv_weight,
        'cs_blur_sigma': cs_blur_sigma,
        'fista_step': fista_step,
        'dct_lambda': dct_lambda,
        'max_auto_scale': max_auto_scale,
    }

    _, metrics, _ = run_once(video, params)
    score = score_from_metrics(metrics, weights)
    # Report useful info
    trial.set_user_attr('metrics', metrics)
    trial.set_user_attr('params', params)
    return score


def main():
    ap = argparse.ArgumentParser(description='Benchmark and tune pipeline parameters (random or Optuna).')
    ap.add_argument('--video', required=True)
    ap.add_argument('--out-dir', default='output/benchmark')
    ap.add_argument('--trials', type=int, default=20)
    ap.add_argument('--sampler', choices=['random', 'optuna'], default='random')
    ap.add_argument('--seed', type=int, default=42)
    # Scoring weights
    ap.add_argument('--w-psnr', type=float, default=0.6)
    ap.add_argument('--w-hf', type=float, default=0.3)
    ap.add_argument('--w-sharp', type=float, default=0.05)
    ap.add_argument('--w-cov3', type=float, default=0.03)
    ap.add_argument('--w-cov4', type=float, default=0.02)
    ap.add_argument('--w-penalty', type=float, default=1.0)
    # Save
    ap.add_argument('--save-best', action='store_true', help='Save the best trial image to out-dir')
    ap.add_argument('--save-all', action='store_true', help='Save images for all trials')
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    weights = dict(psnr=args.w_psnr, hf=args.w_hf, sharp=args.w_sharp, cov3=args.w_cov3, cov4=args.w_cov4, penalty=args.w_penalty)

    rng = random.Random(args.seed)

    best = {'score': -1e9, 'params': None, 'metrics': None}

    if args.sampler == 'optuna':
        try:
            import optuna
        except Exception:
            print('[benchmark] Optuna is not available; falling back to random sampler.')
            args.sampler = 'random'

    if args.sampler == 'random':
        space = make_search_space(rng)
        log = []
        for t in range(args.trials):
            params = sample_params(rng, space)
            start = time.time()
            _, metrics, aux = run_once(args.video, params)
            score = score_from_metrics(metrics, weights)
            elapsed = time.time() - start
            def _py(o):
                import numpy as _np
                if isinstance(o, (_np.floating,)):
                    return float(o)
                if isinstance(o, (_np.integer,)):
                    return int(o)
                return o
            metrics_clean = json.loads(json.dumps(metrics, default=_py))
            rec = {'trial': int(t), 'score': float(score), 'params': params, 'metrics': metrics_clean, 'time_sec': float(elapsed)}
            log.append(rec)
            if score > best['score']:
                best = {'score': score, 'params': params, 'metrics': metrics, 'image': aux.get('out_img')}
            print(f"[trial {t+1}/{args.trials}] score={score:.4f} psnr={metrics.get('consistency_psnr', 0):.2f} hf_gain={metrics.get('hf_gain_vs_bicubic', 0):.3f}")
            # Save trial image optionally
            if args.save_all and aux.get('out_img') is not None:
                cv2.imwrite(str(out_dir / f'trial_{t:03d}.png'), aux['out_img'])
        # Write log and best
        with open(out_dir / 'trials.json', 'w') as f:
            json.dump(log, f, indent=2)
        with open(out_dir / 'best.json', 'w') as f:
            json.dump({'score': float(best['score']), 'params': best['params'], 'metrics': log[int(np.argmax([r['score'] for r in log]))]['metrics']}, f, indent=2)
        if args.save_best and best.get('image') is not None:
            cv2.imwrite(str(out_dir / 'best.png'), best['image'])
        print(f"Best score={best['score']:.4f}; saved reports to {out_dir}")
    else:
        import optuna
        study = optuna.create_study(direction='maximize')
        def _obj(trial):
            return objective_optuna(trial, args.video, weights)
        study.optimize(_obj, n_trials=args.trials)
        print('Best trial:', study.best_trial.value)
        print('Best params:', study.best_trial.params)
        # Save best run image/metrics by re-running once
        params = study.best_trial.params
        _, metrics, aux = run_once(args.video, params)
        with open(out_dir / 'best.json', 'w') as f:
            json.dump({'score': study.best_trial.value, 'params': params, 'metrics': metrics}, f, indent=2)
        if args.save_best and aux.get('out_img') is not None:
            cv2.imwrite(str(out_dir / 'best.png'), aux['out_img'])
        print(f"Saved best report to {out_dir}")


if __name__ == '__main__':
    main()

/**
 * SAAMI cartridge dimensions used to validate and correct the silhouettes.
 *
 * Source: ANSI/SAAMI Z299.1 (rimfire), Z299.2 (shotshell), Z299.3 (centerfire
 * pistol and revolver), and Z299.4 (centerfire rifle) cartridge drawings. Values
 * are the maximum cartridge dimensions in millimetres; `title` records the
 * drawing name so every number can be traced back to the standard.
 *
 * Only cartridges that appear in `data/ammo.js` are listed, and ids match that
 * file. `baseMm` is the case body diameter at the head, `neckMm` the case mouth,
 * `rimMm` the rim (or belt) diameter, and `rimThicknessMm` the rim height.
 *
 * The overlay corrects case geometry only. Bullet diameter and case length stay
 * on the load row so the drawing cannot disagree with the printed numbers.
 */
export const SAAMI_DIMENSIONS = {
  // ── rimfire (Z299.1) ───────────────────────────────────────────────────
  '22lr': {
    standard: 'Z299.1', title: '22 Long Rifle',
    bulletMm: 5.728, caseMm: 15.57, baseMm: 5.74, neckMm: 5.74, rimMm: 7.06, rimThicknessMm: 1.09,
  },
  '22wmr': {
    standard: 'Z299.1', title: '22 Winchester Magnum Rimfire',
    bulletMm: 5.702, caseMm: 26.8, baseMm: 6.15, neckMm: 6.15, rimMm: 7.47, rimThicknessMm: 1.27,
  },
  '17hmr': {
    standard: 'Z299.1', title: '17 Hornady Magnum Rimfire',
    bulletMm: 4.382, caseMm: 27.03, baseMm: 6.15, neckMm: 4.9, rimMm: 7.47, rimThicknessMm: 1.27,
  },

  // ── centerfire pistol and revolver (Z299.3) ────────────────────────────
  '380acp': {
    standard: 'Z299.3', title: '380 Automatic',
    bulletMm: 9.055, caseMm: 17.27, baseMm: 9.497, neckMm: 9.474, rimMm: 9.5, rimThicknessMm: 1.14,
  },
  '9mm': {
    standard: 'Z299.3', title: '9mm Luger / 9mm Luger +P',
    bulletMm: 9.03, caseMm: 19.15, baseMm: 9.931, neckMm: 9.653, rimMm: 10.01, rimThicknessMm: 1.27,
  },
  '38sp': {
    standard: 'Z299.3', title: '38 Special / 38 Special +P',
    bulletMm: 9.093, caseMm: 29.34, baseMm: 9.63, neckMm: 9.63, rimMm: 11.18, rimThicknessMm: 1.12,
  },
  '357mag': {
    standard: 'Z299.3', title: '357 Magnum',
    bulletMm: 9.093, caseMm: 32.77, baseMm: 9.63, neckMm: 9.63, rimMm: 11.18, rimThicknessMm: 1.12,
  },
  '40sw': {
    standard: 'Z299.3', title: '40 Smith & Wesson',
    bulletMm: 10.173, caseMm: 21.59, baseMm: 10.77, neckMm: 10.74, rimMm: 10.77, rimThicknessMm: 1.4,
  },
  '10mm': {
    standard: 'Z299.3', title: '10mm Automatic',
    bulletMm: 10.173, caseMm: 25.2, baseMm: 10.795, neckMm: 10.743, rimMm: 10.8, rimThicknessMm: 1.4,
  },
  '45acp': {
    standard: 'Z299.3', title: '45 Automatic / 45 Automatic +P',
    bulletMm: 11.481, caseMm: 22.81, baseMm: 12.09, neckMm: 12.014, rimMm: 12.19, rimThicknessMm: 1.24,
  },
  '44mag': {
    standard: 'Z299.3', title: '44 Remington Magnum',
    bulletMm: 10.973, caseMm: 32.64, baseMm: 11.605, neckMm: 11.583, rimMm: 13.06, rimThicknessMm: 1.52,
  },
  '50ae': {
    standard: 'Z299.3', title: '50 Action Express',
    bulletMm: 12.75, caseMm: 32.64, baseMm: 13.792, neckMm: 13.437, rimMm: 13.08, rimThicknessMm: 1.52,
  },

  // ── centerfire rifle (Z299.4) ──────────────────────────────────────────
  '223': {
    standard: 'Z299.4', title: '223 Remington',
    bulletMm: 5.702, caseMm: 44.7, baseMm: 9.548, neckMm: 6.43, rimMm: 9.6, rimThicknessMm: 1.14,
  },
  '22-250': {
    standard: 'Z299.4', title: '22-250 Remington',
    bulletMm: 5.702, caseMm: 48.56, baseMm: 11.857, neckMm: 6.45, rimMm: 12.01, rimThicknessMm: 1.24,
  },
  '243': {
    standard: 'Z299.4', title: '243 Winchester',
    bulletMm: 6.17, caseMm: 51.94, baseMm: 11.946, neckMm: 7.01, rimMm: 12.01, rimThicknessMm: 1.4,
  },
  '308': {
    standard: 'Z299.4', title: '308 Winchester',
    bulletMm: 7.85, caseMm: 51.18, baseMm: 11.946, neckMm: 8.725, rimMm: 12.01, rimThicknessMm: 1.4,
  },
  '30-06': {
    standard: 'Z299.4', title: '30-06 Springfield',
    bulletMm: 7.85, caseMm: 63.35, baseMm: 11.933, neckMm: 8.628, rimMm: 12.01, rimThicknessMm: 1.24,
  },
  '30-30': {
    standard: 'Z299.4', title: '30-30 Winchester',
    bulletMm: 7.85, caseMm: 51.803, baseMm: 10.655, neckMm: 8.385, rimMm: 12.85, rimThicknessMm: 1.22,
  },
  '300wm': {
    standard: 'Z299.4', title: '300 Winchester Magnum',
    bulletMm: 7.85, caseMm: 66.55, baseMm: 13.021, neckMm: 8.628, rimMm: 13.51, rimThicknessMm: 1.27,
  },
  '7mmrem': {
    standard: 'Z299.4', title: '7mm Remington Magnum',
    bulletMm: 7.226, caseMm: 63.5, baseMm: 13.023, neckMm: 8.0, rimMm: 13.51, rimThicknessMm: 1.27,
  },
  '338lapua': {
    standard: 'Z299.4', title: '338 Lapua Magnum',
    bulletMm: 8.61, caseMm: 69.2, baseMm: 14.869, neckMm: 9.41, rimMm: 14.93, rimThicknessMm: 1.52,
  },
  '45-70': {
    standard: 'Z299.4', title: '45-70 Government',
    bulletMm: 11.63, caseMm: 53.47, baseMm: 12.799, neckMm: 12.192, rimMm: 15.44, rimThicknessMm: 1.78,
  },
  '65cm': {
    standard: 'Z299.4', title: '6.5 Creedmoor',
    bulletMm: 6.716, caseMm: 48.77, baseMm: 11.946, neckMm: 7.49, rimMm: 11.99, rimThicknessMm: 1.4,
  },
  '300blk': {
    standard: 'Z299.4', title: '300 AAC Blackout',
    bulletMm: 7.85, caseMm: 34.75, baseMm: 9.548, neckMm: 8.48, rimMm: 9.6, rimThicknessMm: 1.14,
  },
  '350legend': {
    standard: 'Z299.4', title: '350 Legend',
    bulletMm: 9.07, caseMm: 43.43, baseMm: 9.906, neckMm: 9.07, rimMm: 9.6, rimThicknessMm: 1.14,
  },
  '450bushmaster': {
    standard: 'Z299.4', title: '450 Bushmaster',
    bulletMm: 11.494, caseMm: 43.18, baseMm: 12.7, neckMm: 11.51, rimMm: 12.01, rimThicknessMm: 1.37,
  },

  // ── shotshell (Z299.2) ─────────────────────────────────────────────────
  '12ga-target': {
    standard: 'Z299.2', title: '12 Gauge 2.75in',
    caseMm: 70.1, baseMm: 20.549, neckMm: 20.549, rimMm: 22.5, rimThicknessMm: 1.463,
  },
  '12ga-buck': {
    standard: 'Z299.2', title: '12 Gauge 2.75in',
    caseMm: 70.1, baseMm: 20.549, neckMm: 20.549, rimMm: 22.5, rimThicknessMm: 1.463,
  },
  '12ga-slug': {
    standard: 'Z299.2', title: '12 Gauge 2.75in',
    caseMm: 70.1, baseMm: 20.549, neckMm: 20.549, rimMm: 22.5, rimThicknessMm: 1.463,
  },
  '12ga-3in-buck': {
    standard: 'Z299.2', title: '12 Gauge 3in',
    caseMm: 76.45, baseMm: 20.549, neckMm: 20.549, rimMm: 22.5, rimThicknessMm: 1.463,
  },
  '12ga-sabot': {
    standard: 'Z299.2', title: '12 Gauge 3in',
    caseMm: 76.45, baseMm: 20.549, neckMm: 20.549, rimMm: 22.5, rimThicknessMm: 1.463,
  },
  '20ga-target': {
    standard: 'Z299.2', title: '20 Gauge 2.75in',
    caseMm: 70.1, baseMm: 17.704, neckMm: 17.704, rimMm: 19.46, rimThicknessMm: 1.229,
  },
  '20ga-slug': {
    standard: 'Z299.2', title: '20 Gauge 2.75in',
    caseMm: 70.1, baseMm: 17.704, neckMm: 17.704, rimMm: 19.46, rimThicknessMm: 1.229,
  },
  '410bore': {
    standard: 'Z299.2', title: '410 Bore 3in',
    caseMm: 76.45, baseMm: 12.116, neckMm: 12.116, rimMm: 13.59, rimThicknessMm: 1.351,
  },
  '410-slug': {
    standard: 'Z299.2', title: '410 Bore 2.5in',
    caseMm: 64.26, baseMm: 12.116, neckMm: 12.116, rimMm: 13.59, rimThicknessMm: 1.351,
  },
};

/** Share one reference between a cartridge and its +P variant. */
SAAMI_DIMENSIONS['9mm-p'] = SAAMI_DIMENSIONS['9mm'];
SAAMI_DIMENSIONS['38sp-p'] = SAAMI_DIMENSIONS['38sp'];
SAAMI_DIMENSIONS['45acp-p'] = SAAMI_DIMENSIONS['45acp'];

/** The reference row for a load id, or undefined when SAAMI does not cover it. */
export function saamiFor(id) {
  return SAAMI_DIMENSIONS[id];
}

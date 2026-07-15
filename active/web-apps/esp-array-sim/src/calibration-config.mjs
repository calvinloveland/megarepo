// Canonical calibration sweep settings shared by the simulator, firmware-shaped
// protocol layer, and future hardware backends.

export const DEFAULT_CALIBRATION_CHIRP_OPTIONS = Object.freeze({
  durationSec: 0.002,
  f0Hz: 3000,
  f1Hz: 8000,
  sampleRateHz: 48000,
  window: true,
});

export const DEFAULT_CALIBRATION_CONFIG = Object.freeze({
  firstEmitSec: 0.1,
  gapSec: 0.3,
  chirp: DEFAULT_CALIBRATION_CHIRP_OPTIONS,
});

// Compact firmware-oriented wire format helpers.
// The protocol layer defines JSON-shaped contracts; this module defines a more
// realistic low-bandwidth target for the eventual firmware transport by
// quantizing times to integer microseconds and distances to integer millimetres.

export const TIME_SCALE_US = 1e6;
export const DIST_SCALE_MM = 1e3;
export const AMP_SCALE_Q1000 = 1000;

function toUs(sec) { return Math.round(sec * TIME_SCALE_US); }
function fromUs(us) { return us / TIME_SCALE_US; }
function toMm(m) { return Math.round(m * DIST_SCALE_MM); }
function fromMm(mm) { return mm / DIST_SCALE_MM; }
function toAmpQ(a) { return Math.round(a * AMP_SCALE_Q1000); }
function fromAmpQ(q) { return q / AMP_SCALE_Q1000; }

export function encodeCalibrationPlanWire(plan) {
  return {
    kind: 'calibration-plan-v1/int-us',
    sweep_id: plan.sweepId,
    gap_us: toUs(plan.gapSec),
    chirp: {
      duration_us: toUs(plan.chirp.durationSec),
      f0_hz: plan.chirp.f0Hz,
      f1_hz: plan.chirp.f1Hz,
      sample_rate_hz: plan.chirp.sampleRateHz,
      window: !!plan.chirp.window,
    },
    emissions: plan.emissions.map((e) => ({ emitter_id: e.emitterId, emit_us: toUs(e.emitClockSec) })),
  };
}

export function decodeCalibrationPlanWire(wire) {
  return {
    kind: 'calibration-plan-v1',
    sweepId: wire.sweep_id,
    gapSec: fromUs(wire.gap_us),
    chirp: {
      durationSec: fromUs(wire.chirp.duration_us),
      f0Hz: wire.chirp.f0_hz,
      f1Hz: wire.chirp.f1_hz,
      sampleRateHz: wire.chirp.sample_rate_hz,
      window: !!wire.chirp.window,
    },
    emissions: wire.emissions.map((e) => ({ emitterId: e.emitter_id, emitClockSec: fromUs(e.emit_us) })),
  };
}

export function encodeListenerRowWire(packet) {
  return {
    kind: 'listener-row-v1/int-us',
    sweep_id: packet.sweepId,
    listener_id: packet.listenerId,
    arrivals: packet.arrivals.map((a) => ({
      emitter_id: a.emitterId,
      emit_us: toUs(a.emitClockSec),
      arrival_us: toUs(a.arrivalClockSec),
      distance_mm: toMm(a.distanceM),
      ...(a.estimatedDirectSec != null ? { estimated_direct_us: toUs(a.estimatedDirectSec) } : {}),
      ...(a.arrivalPaths ? {
        arrival_paths: a.arrivalPaths.map((p) => ({
          delay_us: toUs(p.delaySec),
          amplitude_q1000: toAmpQ(p.amplitude),
          kind: p.kind,
        })),
      } : {}),
      ...(a.shots ? { shots_us: a.shots.map((s) => toUs(s)) } : {}),
    })),
  };
}

export function decodeListenerRowWire(wire) {
  return {
    kind: 'listener-row-v1',
    sweepId: wire.sweep_id,
    listenerId: wire.listener_id,
    arrivals: wire.arrivals.map((a) => ({
      emitterId: a.emitter_id,
      emitClockSec: fromUs(a.emit_us),
      arrivalClockSec: fromUs(a.arrival_us),
      distanceM: fromMm(a.distance_mm),
      ...(a.estimated_direct_us != null ? { estimatedDirectSec: fromUs(a.estimated_direct_us) } : {}),
      ...(a.arrival_paths ? {
        arrivalPaths: a.arrival_paths.map((p) => ({
          delaySec: fromUs(p.delay_us),
          amplitude: fromAmpQ(p.amplitude_q1000),
          kind: p.kind,
        })),
      } : {}),
      ...(a.shots_us ? { shots: a.shots_us.map((s) => fromUs(s)) } : {}),
    })),
  };
}

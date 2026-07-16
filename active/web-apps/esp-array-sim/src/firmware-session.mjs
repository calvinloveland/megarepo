import { runDistributedWithBackend } from './firmware-backend.mjs';
import { localizeBest, procrustesAlign } from './localize.mjs';
import { mapSurround, speakerCompensation } from './surround.mjs';

export const FIRMWARE_STATES = Object.freeze([
  'BOOT',
  'SYNC_CLOCKS',
  'BUILD_PLAN',
  'CAPTURE_ROWS',
  'GOSSIP_ROWS',
  'SOLVE_LAYOUT',
  'READY_FOR_SURROUND',
]);

/**
 * Simulator-side execution of the future coordinator firmware lifecycle.
 * When truth is supplied, the session also evaluates mirror/Procrustes error for
 * simulator scoring. Without truth, it still returns the raw solved positions.
 */
export function runFirmwareSession(opts) {
  const {
    nodes,
    room,
    backend,
    seedRng,
    starts = 8,
    withSkew = false,
    robust = 0,
    truth = null,
    sweetSpot = { x: room.width / 2, y: room.height / 2 },
    exponent,
    distanceLaw,
    distributedMatched = false,
  } = opts;

  const acquisition = runDistributedWithBackend(nodes, backend);
  const sol = localizeBest(acquisition.matrix, nodes.length, room, {
    starts,
    seedRng,
    withSkew,
    robust,
  });

  let aligned = sol.pos;
  let transform = { R: [[1, 0], [0, 1]], t: { x: 0, y: 0 }, mirror: false };
  let alignErrorM = null;

  if (truth) {
    const mirrored = sol.pos.map((p) => ({ x: p.x, y: -p.y }));
    const a1 = procrustesAlign(sol.pos, truth);
    const a2 = procrustesAlign(mirrored, truth);
    const best = a2.errorM < a1.errorM ? { ...a2, mirror: true } : { ...a1, mirror: false };
    aligned = best.aligned;
    transform = { R: best.R, t: best.t, mirror: best.mirror };
    alignErrorM = best.errorM;
  }

  const solvedPositions = truth ? aligned : sol.pos;
  const realSpeakers = solvedPositions.map((p, i) => ({ id: nodes[i].label, pos: { x: p.x, y: p.y } }));
  const surround = mapSurround(realSpeakers, sweetSpot, { exponent, distanceLaw });
  const compensation = speakerCompensation(realSpeakers, sweetSpot);

  return {
    trace: FIRMWARE_STATES,
    distributed: true,
    distributedMatched,
    sync: acquisition.sync,
    plan: acquisition.plan,
    schedule: acquisition.schedule,
    perNode: acquisition.perNode,
    rowPackets: acquisition.rowPackets,
    allRowPackets: acquisition.allRowPackets ?? acquisition.rowPackets,
    matrix: acquisition.matrix,
    messages: acquisition.messages,
    lost: acquisition.lost,
    solution: sol,
    aligned: solvedPositions,
    transform,
    alignErrorM,
    realSpeakers,
    surround,
    compensation,
    sweetSpot,
  };
}

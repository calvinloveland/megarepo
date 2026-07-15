import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CHIRP_CONFIG,
  makeCalibrationPlan,
  rowsToListenerPackets,
  listenerPacketsToMatrix,
  broadcastCostForPackets,
  gossipPacketsAndAssemble,
} from '../src/firmware-protocol.mjs';
import { makeRng, randomLayout, makeEmitSchedule } from '../src/world.mjs';
import { simulateCaptures, simulateMatchedCaptures } from '../src/capture.mjs';

test('makeCalibrationPlan exposes a firmware-shaped chirp plan from the schedule', () => {
  const nodes = randomLayout(4, { width: 6, height: 5 }, makeRng(1));
  const schedule = makeEmitSchedule(nodes);
  const plan = makeCalibrationPlan(schedule);
  assert.equal(plan.kind, 'calibration-plan-v1');
  assert.equal(plan.emissions.length, schedule.length);
  assert.deepEqual(plan.chirp, DEFAULT_CHIRP_CONFIG);
  assert.equal(plan.emissions[0].emitterId, schedule[0].emitterId);
});

test('listener-row packets round-trip a closed-form observation matrix exactly', () => {
  const nodes = randomLayout(5, { width: 6, height: 5 }, makeRng(2));
  const schedule = makeEmitSchedule(nodes);
  const obs = simulateCaptures(nodes, schedule);
  const perNode = nodes.map((n) => obs.filter((o) => o.listenerId === n.id));
  const packets = rowsToListenerPackets(perNode, { sweepId: 't1' });
  const round = listenerPacketsToMatrix(packets);
  const key = (o) => `${o.emitterId}-${o.listenerId}`;
  const sort = (xs) => xs.slice().sort((a, b) => key(a).localeCompare(key(b)));
  assert.deepEqual(sort(round), sort(obs));
});

test('listener-row packets preserve matched-capture diagnostics', () => {
  const room = { width: 6, height: 5 };
  const nodes = randomLayout(4, room, makeRng(3));
  const schedule = makeEmitSchedule(nodes);
  const obs = simulateMatchedCaptures(nodes, schedule, { room, reflCoef: 0.5 });
  const perNode = nodes.map((n) => obs.filter((o) => o.listenerId === n.id));
  const packets = rowsToListenerPackets(perNode, { sweepId: 'matched' });
  const round = listenerPacketsToMatrix(packets);
  const sample = round.find((o) => o.listenerId !== o.emitterId);
  assert.ok(Array.isArray(sample.arrivalPaths), 'matched diagnostics preserved');
  assert.ok(sample.estimatedDirectSec > 0, 'estimated direct TOA preserved');
});

test('full-broadcast packet cost is still n*(n-1)', () => {
  const packets = rowsToListenerPackets([[{ listenerId: 0 }], [{ listenerId: 1 }], [{ listenerId: 2 }]]);
  assert.equal(broadcastCostForPackets(packets), 3 * 2);
});

test('packet-level gossip loss drops whole listener-row packets', () => {
  const packets = rowsToListenerPackets([
    [{ emitterId: 0, listenerId: 0, emitClockSec: 0, arrivalClockSec: 0, distanceM: 0.01 }],
    [{ emitterId: 0, listenerId: 1, emitClockSec: 0, arrivalClockSec: 0.02, distanceM: 2 }],
    [{ emitterId: 0, listenerId: 2, emitClockSec: 0, arrivalClockSec: 0.03, distanceM: 3 }],
  ]);
  const g = gossipPacketsAndAssemble(packets, { loss: 0.5, seedRng: makeRng(1) });
  assert.ok(g.packets.length < packets.length, 'some whole row packets dropped');
  assert.equal(g.messages + g.lost, 3 * 2);
});
#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeFirmwareFixtures } from '../src/firmware-fixtures.mjs';

const outDir = resolve(process.cwd(), 'firmware/examples');
mkdirSync(outDir, { recursive: true });
const fixtures = makeFirmwareFixtures();
writeFileSync(resolve(outDir, 'calibration-plan.example.json'), JSON.stringify(fixtures.plan, null, 2) + '\n');
writeFileSync(resolve(outDir, 'calibration-plan.wire.example.json'), JSON.stringify(fixtures.planWire, null, 2) + '\n');
writeFileSync(resolve(outDir, 'listener-rows.closed.example.json'), JSON.stringify(fixtures.listenerRowsClosed, null, 2) + '\n');
writeFileSync(resolve(outDir, 'listener-rows.closed.wire.example.json'), JSON.stringify(fixtures.listenerRowsClosedWire, null, 2) + '\n');
writeFileSync(resolve(outDir, 'listener-rows.matched.example.json'), JSON.stringify(fixtures.listenerRowsMatched, null, 2) + '\n');
writeFileSync(resolve(outDir, 'listener-rows.matched.wire.example.json'), JSON.stringify(fixtures.listenerRowsMatchedWire, null, 2) + '\n');
console.log(`wrote ${outDir}/calibration-plan.example.json`);
console.log(`wrote ${outDir}/calibration-plan.wire.example.json`);
console.log(`wrote ${outDir}/listener-rows.closed.example.json`);
console.log(`wrote ${outDir}/listener-rows.closed.wire.example.json`);
console.log(`wrote ${outDir}/listener-rows.matched.example.json`);
console.log(`wrote ${outDir}/listener-rows.matched.wire.example.json`);

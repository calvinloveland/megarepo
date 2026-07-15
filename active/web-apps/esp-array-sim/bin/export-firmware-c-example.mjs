#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWireExampleHeader } from '../src/firmware-c-example.mjs';

const outDir = resolve(process.cwd(), 'firmware/host');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'esp_array_wire_example.h'), renderWireExampleHeader());
console.log(`wrote ${outDir}/esp_array_wire_example.h`);

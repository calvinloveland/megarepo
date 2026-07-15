#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderFirmwareCalibrationHeader, renderFirmwareProtocolHeader } from '../src/firmware-headers.mjs';

const outDir = resolve(process.cwd(), 'firmware/include');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'esp_array_calibration.h'), renderFirmwareCalibrationHeader());
writeFileSync(resolve(outDir, 'esp_array_protocol.h'), renderFirmwareProtocolHeader());
console.log(`wrote ${outDir}/esp_array_calibration.h`);
console.log(`wrote ${outDir}/esp_array_protocol.h`);

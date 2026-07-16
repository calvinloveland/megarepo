#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderFirmwareCalibrationHeader, renderFirmwareProtocolHeader } from '../src/firmware-headers.mjs';
import { renderFirmwareFrameHeader } from '../src/firmware-frame.mjs';

const outDir = resolve(process.cwd(), 'firmware/include');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'esp_array_calibration.h'), renderFirmwareCalibrationHeader());
writeFileSync(resolve(outDir, 'esp_array_protocol.h'), renderFirmwareProtocolHeader());
writeFileSync(resolve(outDir, 'esp_array_frame.h'), renderFirmwareFrameHeader());
console.log(`wrote ${outDir}/esp_array_calibration.h`);
console.log(`wrote ${outDir}/esp_array_protocol.h`);
console.log(`wrote ${outDir}/esp_array_frame.h`);

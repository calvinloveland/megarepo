import { makeFirmwareFixtures } from './firmware-fixtures.mjs';

export function renderWireExampleHeader() {
  const fx = makeFirmwareFixtures();
  const rows = fx.listenerRowsClosedWire;
  const lines = [
    '// Generated from src/firmware-fixtures.mjs — do not hand-edit.',
    '#ifndef ESP_ARRAY_WIRE_EXAMPLE_H',
    '#define ESP_ARRAY_WIRE_EXAMPLE_H',
    '',
    '#include "../include/esp_array_protocol.h"',
    '',
  ];

  rows.forEach((row, idx) => {
    lines.push(`static const esp_array_arrival_wire_t ESP_ARRAY_EXAMPLE_ROW_${idx}_ARRIVALS[] = {`);
    for (const a of row.arrivals) {
      lines.push(`  { .emitter_id = ${a.emitter_id}, .emit_us = ${a.emit_us}, .arrival_us = ${a.arrival_us}, .distance_mm = ${a.distance_mm} },`);
    }
    lines.push('};', '');
  });

  lines.push('static const esp_array_listener_row_wire_t ESP_ARRAY_EXAMPLE_ROWS[] = {');
  rows.forEach((row, idx) => {
    lines.push(`  { .listener_id = ${row.listener_id}, .arrival_count = ${row.arrivals.length}, .arrivals = ESP_ARRAY_EXAMPLE_ROW_${idx}_ARRIVALS },`);
  });
  lines.push('};', '');
  lines.push(`#define ESP_ARRAY_EXAMPLE_ROW_COUNT ${rows.length}`);
  lines.push('', '#endif // ESP_ARRAY_WIRE_EXAMPLE_H', '');
  return lines.join('\n');
}

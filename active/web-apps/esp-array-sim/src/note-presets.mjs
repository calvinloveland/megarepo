export const NOTE_PRESETS = Object.freeze([
  { id: 'hard-reverb', label: 'hard living-room reverb' },
  { id: 'lossy-mesh', label: 'lossy distributed mesh' },
  { id: 'skew-stress', label: 'clock-skew stress' },
  { id: 'high-noise', label: 'high-noise scan' },
]);

export function getNotePreset(id) {
  return NOTE_PRESETS.find((p) => p.id === id) ?? null;
}

export function applyNotePreset(current, id) {
  const preset = getNotePreset(id);
  const base = (current || '').trim();
  if (!preset) return base;
  if (!base) return preset.label;
  if (base.includes(preset.label)) return base;
  return `${base} · ${preset.label}`;
}

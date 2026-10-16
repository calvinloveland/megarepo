/*
 * Steampunk palette.
 *
 * Colours are cosmetic and free per PROTOCOL.md/FEATURES.md — the *rules* are
 * fixed, the look is not. Every tetromino gets a distinct metal so the board is
 * readable at a glance on a big screen, with brass rivets as the shared motif.
 */

export const PIECE_PALETTE = {
  I: { face: '#7ba7b8', light: '#cbe3ec', dark: '#2f4d59', glow: 'rgba(123,167,184,.55)', name: 'steel' },
  O: { face: '#d3a132', light: '#f7e19a', dark: '#6d4c0c', glow: 'rgba(211,161,50,.55)', name: 'brass' },
  T: { face: '#b5623f', light: '#eaa886', dark: '#552513', glow: 'rgba(181,98,63,.55)', name: 'copper' },
  S: { face: '#5c9d7d', light: '#a9d9c1', dark: '#24483a', glow: 'rgba(92,157,125,.55)', name: 'verdigris' },
  Z: { face: '#9d3b30', light: '#dd8a7d', dark: '#48150f', glow: 'rgba(157,59,48,.55)', name: 'rust' },
  J: { face: '#52699c', light: '#9db2dc', dark: '#212c48', glow: 'rgba(82,105,156,.55)', name: 'gunmetal' },
  L: { face: '#a97c50', light: '#e0bd93', dark: '#4d3319', glow: 'rgba(169,124,80,.55)', name: 'bronze' },
};

export const INK = {
  brass: '#c8a24a',
  brassBright: '#f0d68b',
  copper: '#b87333',
  iron: '#3a3833',
  ironDark: '#211f1c',
  soot: '#141210',
  steam: 'rgba(233,226,214,',
  ember: '#ff9a3c',
};

export const PIECE_GLYPH = {
  I: '\u2016', O: '\u25cb', T: '\u03c8', S: '\u224b', Z: '\u2262', J: '\u2699', L: '\u2692',
};

/**
 * Jurisdiction restrictions, derived from statute-shaped rules.
 *
 * Legality is not a trade-off like cost or recoil, so it is not part of the Case
 * weighting: a load may be possessed by a civilian or it may not, and the answer
 * comes from statute, not physics. The table carries it as an overlay — the same
 * pattern as `data/inventors.js` — so the load data stays clean and the legal
 * summary can be audited, corrected, and dated on its own.
 *
 * The rules below are written the way the statutes are written (calibre classes,
 * not one entry per cartridge), and `EXCEPTIONS` records the cases where a
 * diameter rule and the law disagree. The clearest one: Mexico permits .38
 * Special revolvers but not .357 Magnum, even though both use a .357" bullet.
 *
 * This is a summary for comparison, not legal advice. Rules change, they differ
 * between possession, carry, and transport, and they often depend on the firearm
 * as much as the cartridge. Verify with a local authority before relying on it.
 */

/** Jurisdictions the overlay covers. */
export const JURISDICTIONS = [
  {
    code: 'MX',
    label: 'Mexico',
    scope: 'civilian possession',
    basis: 'Ley Federal de Armas de Fuego y Explosivos, Art. 10',
    url: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LFAFE.pdf',
    checked: '2026-10',
  },
  {
    code: 'IT',
    label: 'Italy',
    scope: 'civilian ownership',
    basis: 'L. 110/1975 and the military-calibre list',
    url: 'https://www.gazzettaufficiale.it/eli/id/1975/04/21/075U0110/sg',
    checked: '2026-10',
  },
  {
    code: 'CA',
    label: 'Canada',
    scope: 'prohibited firearms',
    basis: 'Criminal Code s.84(1), "prohibited firearm"',
    url: 'https://laws-lois.justice.gc.ca/eng/acts/c-46/section-84.html',
    checked: '2026-10',
  },
];

const MX_PISTOL =
  'Art. 10 permits civilian pistols in .22, .25, .32 and .380 only; larger pistol calibres are reserved for the armed forces.';
const MX_RIFLE =
  'Art. 10 reserves rifles above .30 calibre for the armed forces.';
const IT_9X19 =
  '9×19 is treated as a military calibre; 9×21 IMI is the usual legal substitute for the same pistol.';
const CA_SMALL =
  'Handguns in .25 or .32 calibre are prohibited outright; other handguns are restricted or prohibited by barrel length regardless of calibre.';

/** Canada names the small calibres explicitly, so this rule is an id list. */
const CA_SMALL_CALIBRES = new Set([
  '25acp',
  '32acp',
  '32-naa',
  '32-s-and-w',
  '32-s-and-w-long',
  '32-h-and-r-magnum',
]);

const isNineMillimetre = (row) => /^9\s?mm Luger/i.test(row.name);
const boreIn = (row) => row.diameterIn ?? 0;

/**
 * Mexico's list is written by calibre designation, not by diameter — which is
 * the only way to separate .380 ACP from 9mm Parabellum, both of which use a
 * .355" bullet. Anything in the pistol class outside these families is reserved.
 */
const MX_PISTOL_FAMILIES = /^(\.22|\.25|\.32|\.380)/i;

/**
 * One rule per (jurisdiction, statutory test). A rule's note is shown verbatim
 * in the row detail, so it has to stand on its own.
 */
export const RULES = [
  {
    code: 'MX',
    key: 'mx-pistol',
    note: MX_PISTOL,
    test: (row) => row.category === 'pistol' && !MX_PISTOL_FAMILIES.test(row.name),
  },
  {
    code: 'MX',
    key: 'mx-rifle',
    // "Above .30 calibre": .308" (.30-06, .308 Win, .30-30) stays, .311" and up
    // (.303, 7.62x39, 7.62x54R, 8mm, 9.3mm) does not.
    note: MX_RIFLE,
    test: (row) => row.category === 'rifle' && boreIn(row) > 0.3095,
  },
  {
    code: 'IT',
    key: 'it-military-calibre',
    note: IT_9X19,
    test: (row) => isNineMillimetre(row),
  },
  {
    code: 'CA',
    key: 'ca-small-calibre',
    note: CA_SMALL,
    test: (row) => CA_SMALL_CALIBRES.has(row.id),
  },
];

/**
 * Cases where the statute and the diameter rule disagree. `null` clears a rule
 * the test would otherwise fire; a note adds a restriction no rule can see.
 */
export const EXCEPTIONS = {
  // Mexico permits .38 Special revolvers explicitly; .357 Magnum is not listed.
  '38sp': { MX: null },
  '38sp-p': { MX: null },
  // .32-20 is a permitted revolver calibre, not a reserved rifle calibre.
  '32-20-winchester': { MX: null },
};

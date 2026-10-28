/**
 * Fetch real product listings from wikiarms.com into a JSON export.
 *
 * The app never fetches anything at runtime, and this tool is not part of the
 * app: it is a curation step you run deliberately, and its output goes through
 * `tools/import-products.mjs` (which validates before anything reaches the
 * checked-in catalog).
 *
 * Source: <https://www.wikiarms.com/group/<calibre>> — a public price aggregator
 * whose rows carry a product title, the box price, the round count, and the
 * vendor. Its robots.txt allows `/group/*`; this tool touches nothing else (no
 * `/go/*` affiliate links, no `/live-inventory-feed/*`) and waits between
 * requests.
 *
 * Usage:
 *   node tools/fetch-listings.mjs                       # default groups
 *   node tools/fetch-listings.mjs --groups 9mm,223 --per-group 15
 *   node tools/fetch-listings.mjs --out /tmp/listings.json
 *
 * What the data is, and is not:
 *
 * - Prices are a snapshot of the aggregator's cheapest listings at the time of
 *   the run, dated in `priceChecked`. They are not a live feed and not a quote.
 * - `line` is derived from the listing title (a known product family if the
 *   title names one, otherwise the bullet construction), and `note` keeps the
 *   vendor's full title so nothing is lost.
 * - A velocity is taken from the listing title where it carries one, which is
 *   normally the manufacturer's published figure; the importer marks those rows
 *   `velocitySource: 'manufacturer'`.
 */
import { writeFileSync } from 'node:fs';

const BASE = 'https://www.wikiarms.com';
const USER_AGENT =
  'ammo-compare/0.1 (personal price snapshot; one request per calibre; contact: local)';

/** Calibre groups to read, and the cartridge each maps to in data/ammo.js. */
const GROUPS = {
  '9mm': '9mm',
  '380': '380acp',
  '40': '40sw',
  '45': '45acp',
  '357': '357mag',
  '38': '38sp',
  '10mm': '10mm',
  '22': '22lr',
  '17hmr': '17hmr',
  '9x18': '9x18mm-makarov',
  '223': '223',
  '308': '308',
  '22-250': '22250',
  '243': '243',
  '270': '270win',
  '30-06': '30-06',
  '30-30': '30-30',
  '44mag': '44mag',
  '7mm-08': '7mm-08-remington',
};

/** Box sizes the catalog accepts; anything else is skipped rather than coerced. */
const PACKAGE_SIZES = [5, 10, 20, 25, 50, 100, 150, 200, 250, 300, 500, 1000, 2000];

/**
 * Brands, longest first so "Sellier & Bellot" wins over "Sellier". A title that
 * matches nothing keeps its first token as the brand — the note still carries the
 * full listing, so nothing is invented.
 */
const BRANDS = [
  'Sellier & Bellot',
  'Prvi Partizan',
  'Wolf Performance',
  'Red Army Standard',
  'Buffalo Bore',
  'Underwood Ammo',
  'Freedom Munitions',
  'Precision One',
  'American Eagle',
  'Black Hills',
  'DoubleTap',
  'Rock Island',
  'Silver Bear',
  'Golden Bear',
  'Brown Bear',
  'Sig Sauer',
  'MaxxTech',
  'Cor-Bon',
  'Ammo Inc',
  'True Shot',
  'Everglades',
  'Armscor',
  'Winchester',
  'Remington',
  'Hornady',
  'Federal',
  'Fiocchi',
  'Blazer',
  'Magtech',
  'Aguila',
  'Nosler',
  'Barnes',
  'Norma',
  'Lapua',
  'Gorilla',
  'Steinel',
  'Sterling',
  'Monarch',
  'Independence',
  "Herter's",
  'Palmetto',
  'Sarsilmaz',
  'Velocity',
  'Fenix',
  'Turan',
  'Igman',
  'Belom',
  'Geco',
  'Ruag',
  'Sako',
  'Tula',
  'Wolf',
  'Speer',
  'Blazer',
  'Estate',
  'Rio',
  'B&P',
  'HSM',
  'CBC',
  'ZQI',
  'MEN',
  'RWS',
  'LAX',
  'AAC',
  'PMC',
  'CCI',
  'IMI',
  'BPS',
];

/** Product families worth naming in `line` when the title mentions them. */
const FAMILIES = [
  'Gold Medal Match',
  'Gold Dot',
  'Critical Defense',
  'Critical Duty',
  'Hydra-Shok',
  'Golden Saber',
  'Power-Shok',
  'Silvertip',
  'V-Crown',
  'Syntech',
  'Lawman',
  'X-TAC',
  'Ranger',
  'Frontier',
  'Blazer Brass',
  'Blazer',
  'American Eagle',
  'UMC',
  'XTP',
  'Punch',
  'HST',
  'Elite',
  'Match',
  'Defender',
  'HAP',
];

const decode = (text) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();

const slug = (text) =>
  text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function brandOf(title) {
  const lower = title.toLowerCase();
  for (const brand of BRANDS) {
    if (lower.startsWith(brand.toLowerCase())) {
      return { brand, rest: title.slice(brand.length).trim() };
    }
  }
  const [first, ...rest] = title.split(' ');
  return { brand: first, rest: rest.join(' ') };
}

function familyOf(title) {
  const lower = title.toLowerCase();
  for (const family of FAMILIES) {
    if (lower.includes(family.toLowerCase())) return family;
  }
  return null;
}

/** Parse one `<tr>` from the listings table. */
function parseRow(row, cartridge) {
  const cell = (name) => {
    const match = row.match(new RegExp(`<td class="${name}[^"]*"[^>]*>([\\s\\S]*?)</td>`, 'i'));
    return match ? decode(match[1].replace(/<[^>]+>/g, ' ')) : '';
  };
  const titleHtml = row.match(/<td class="product"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
  if (!titleHtml) return null;
  const title = decode(titleHtml[1].replace(/<[^>]+>/g, ' '));

  const priceText = cell('price').replace(/[^0-9.]/g, '');
  const priceUsd = Number(priceText);
  const packageRounds = Number(cell('rounds').replace(/[^0-9]/g, ''));
  const vendorMatch = row.match(/<td class="host[^"]*"[^>]*>\s*<a href="\/stores\/([^/"]+)\/ammo">([\s\S]*?)<\/a>/i);
  const vendorSlug = vendorMatch ? vendorMatch[1] : null;
  const vendor = vendorMatch ? decode(vendorMatch[2]) : null;

  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  if (!PACKAGE_SIZES.includes(packageRounds)) return null;

  const grain = title.match(/(\d{2,3})\s*(?:gr|grain)\b/i);
  const bulletGr = grain ? Number(grain[1]) : null;
  if (!bulletGr || bulletGr <= 0) return null;

  const velocity = title.match(/(\d{3,4})\s*FPS/i);
  const typeMatch = title.match(
    /(?:\d{2,3})\s*(?:gr|grain)\s+(.+?)(?=\s+\d{3,4}\s*FPS|\s+\d+\s*(?:rounds|Bx|Per Box)|\s*$)/i,
  );
  const bulletType = typeMatch ? typeMatch[1].replace(/[,\s]+$/, '').trim() : null;

  const { brand, rest } = brandOf(title);
  const family = familyOf(title);
  const line = family ?? (bulletType ? `${bulletGr} gr ${bulletType}` : rest.slice(0, 60));

  return {
    id: slug(`${brand} ${line} ${packageRounds} ${vendorSlug ?? 'x'}`).slice(0, 80),
    cartridge,
    brand,
    line,
    bulletGr,
    bulletType: bulletType ?? undefined,
    packageRounds,
    velocityFps: velocity ? Number(velocity[1]) : undefined,
    velocitySource: velocity ? 'manufacturer' : 'cartridge',
    priceUsd: Number(priceUsd.toFixed(2)),
    priceSource: vendor ? `wikiarms.com · ${vendor}` : 'wikiarms.com',
    priceChecked: new Date().toISOString().slice(0, 10),
    source: 'wikiarms.com',
    sourceUrl: `${BASE}/group/${cartridge}`,
    note: title,
  };
}

function parsePage(html, cartridge) {
  const body = html.slice(html.indexOf('<tbody'));
  const rows = body.match(/<tr id="product\d+"[\s\S]*?<\/tr>/g) ?? [];
  return rows.map((row) => parseRow(row, cartridge)).filter(Boolean);
}

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};
const perGroup = Number(option('per-group', 20));
const out = option('out', '/tmp/listings.json');
const requested = option('groups', null);
const groups = requested
  ? requested.split(',').map((group) => group.trim()).filter(Boolean)
  : Object.keys(GROUPS);

const products = [];
const skipped = [];
for (const group of groups) {
  const cartridge = GROUPS[group];
  if (!cartridge) {
    console.error(`skip ${group}: no cartridge mapping`);
    continue;
  }
  const response = await fetch(`${BASE}/group/${group}`, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
  });
  if (!response.ok) {
    skipped.push(`${group}: HTTP ${response.status}`);
    continue;
  }
  const html = await response.text();
  const parsed = parsePage(html, cartridge);
  // The table is ordered cheapest first, so the head is the useful slice.
  const slice = parsed.slice(0, perGroup);
  products.push(...slice);
  console.error(`${group} -> ${cartridge}: ${slice.length} of ${parsed.length} listings`);
  await new Promise((resolve) => setTimeout(resolve, 1200));
}

// Two rows can collapse to the same id when a vendor lists the same box twice.
const unique = new Map();
for (const product of products) {
  let id = product.id;
  let suffix = 2;
  while (unique.has(id)) id = `${product.id}-${suffix++}`;
  unique.set(id, { ...product, id });
}

writeFileSync(out, JSON.stringify({ products: [...unique.values()] }, null, 2));
console.error(`\nwrote ${out} — ${unique.size} listings`);
if (skipped.length) console.error(`skipped: ${skipped.join(', ')}`);

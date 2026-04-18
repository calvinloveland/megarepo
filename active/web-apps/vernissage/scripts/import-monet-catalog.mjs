import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const baseCatalogPath = path.join(projectRoot, 'src', 'content', 'demo-content.json');
const outputDir = path.join(projectRoot, 'src', 'content', 'artist-catalogs');
const outputPath = path.join(outputDir, 'claude-monet.json');
const targetTotal = 1000;
const artistSlug = 'claude-monet';
const movementSlug = 'impressionism';
const existingCatalog = JSON.parse(await readFile(baseCatalogPath, 'utf8'));
const existingMonetWorks = existingCatalog.artworks.filter((artwork) => artwork.artistSlug === artistSlug);
const existingTitleKeys = new Set(existingMonetWorks.map((artwork) => normalizeTitleKey(artwork.title)));
const requiredNewWorks = Math.max(0, targetTotal - existingMonetWorks.length);

const query = `
SELECT ?work ?inception
  (GROUP_CONCAT(DISTINCT ?materialLabel; separator=", ") AS ?materials)
  (GROUP_CONCAT(DISTINCT ?genreLabel; separator=", ") AS ?genres)
WHERE {
  ?work wdt:P170 wd:Q296;
        wdt:P31/wdt:P279* wd:Q3305213.
  OPTIONAL { ?work wdt:P571 ?inception. }
  OPTIONAL {
    ?work wdt:P186 ?material.
    ?material rdfs:label ?materialLabel.
    FILTER(LANG(?materialLabel) = "en")
  }
  OPTIONAL {
    ?work wdt:P136 ?genre.
    ?genre rdfs:label ?genreLabel.
    FILTER(LANG(?genreLabel) = "en")
  }
}
GROUP BY ?work ?inception
ORDER BY ?inception ?work
LIMIT 2000
`;

const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
const response = await fetch(url, {
  headers: {
    'user-agent': 'megarepo-vernissage-catalog-bot/1.0 (https://github.com/github/copilot-cli)'
  }
});

if (!response.ok) {
  throw new Error(`Wikidata Monet query failed with ${response.status}`);
}

const payload = await response.json();
const titlesById = await fetchEntityLabels(
  payload.results.bindings
    .map((row) => row.work?.value?.split('/').pop())
    .filter(Boolean)
);
const usedSlugs = new Set(existingCatalog.artworks.map((artwork) => artwork.slug));
const generatedWorks = [];

for (const row of payload.results.bindings) {
  const qid = row.work?.value?.split('/').pop();
  if (!qid) {
    continue;
  }

  const title = titlesById.get(qid)?.trim();
  if (!title) {
    continue;
  }

  const normalizedTitle = normalizeTitleKey(title);
  if (existingTitleKeys.has(normalizedTitle)) {
    continue;
  }

  const year = formatYear(row.inception?.value);
  const medium = formatMedium(row.materials?.value);
  const genre = firstValue(row.genres?.value);
  const slug = createUniqueSlug(title, year, qid, usedSlugs);
  usedSlugs.add(slug);

  generatedWorks.push({
    slug,
    title,
    artistSlug,
    movementSlug,
    year,
    medium,
    dimensions: 'Not yet catalogued',
    tags: compact([
      'catalog record',
      'public domain',
      genre,
      year.endsWith('s') ? year : undefined
    ]),
    summary: buildSummary(title, year, genre)
  });

  if (generatedWorks.length >= requiredNewWorks) {
    break;
  }
}

if (generatedWorks.length < requiredNewWorks) {
  throw new Error(`Only generated ${generatedWorks.length} Monet records; needed ${requiredNewWorks}`);
}

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(generatedWorks, null, 2)}\n`);
console.log(`Wrote ${generatedWorks.length} Monet records to ${path.relative(projectRoot, outputPath)}`);

function normalizeTitleKey(title) {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function createUniqueSlug(title, year, qid, usedSlugs) {
  const candidates = compact([
    slugify(title),
    `${slugify(title)}-${slugify(year)}`,
    `${slugify(title)}-${qid.toLowerCase()}`
  ]);

  for (const candidate of candidates) {
    if (candidate && !usedSlugs.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Could not generate a unique slug for ${title}`);
}

function formatYear(value) {
  const match = value?.match(/\d{4}/);
  return match ? match[0] : 'Date not yet catalogued';
}

function formatMedium(value) {
  if (!value) {
    return 'Medium not yet catalogued';
  }

  const normalized = new Set(
    value
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
  );

  if (normalized.has('oil paint') && normalized.has('canvas')) {
    return 'Oil on canvas';
  }

  if (normalized.has('oil paint') && normalized.has('panel')) {
    return 'Oil on panel';
  }

  return Array.from(normalized)
    .map((part) => part.replace(/\b\w/g, (letter) => letter.toUpperCase()))
    .join(', ');
}

function firstValue(value) {
  return value
    ?.split(',')
    .map((part) => part.trim())
    .find(Boolean);
}

function compact(values) {
  return values.filter(Boolean);
}

function buildSummary(title, year, genre) {
  const qualifier = compact([
    year !== 'Date not yet catalogued' ? year : undefined,
    genre
  ]).join(' ');

  return qualifier
    ? `Catalog record for Claude Monet's ${qualifier} work ${title}. Vernissage has added the piece to the dossier while a reusable image source and fuller curatorial notes are still being prepared.`
    : `Catalog record for Claude Monet's ${title}. Vernissage has added the piece to the dossier while a reusable image source and fuller curatorial notes are still being prepared.`;
}

async function fetchEntityLabels(ids) {
  const uniqueIds = Array.from(new Set(ids));
  const chunkSize = 50;
  const batches = [];

  for (let index = 0; index < uniqueIds.length; index += chunkSize) {
    batches.push(uniqueIds.slice(index, index + chunkSize));
  }

  const responses = await Promise.all(
    batches.map(async (batch) => {
      const params = new URLSearchParams({
        action: 'wbgetentities',
        format: 'json',
        props: 'labels',
        languages: 'en|fr|de|it|nl|es',
        languagefallback: '1',
        ids: batch.join('|'),
        origin: '*'
      });
      const response = await fetch(`https://www.wikidata.org/w/api.php?${params.toString()}`, {
        headers: {
          'user-agent': 'megarepo-vernissage-catalog-bot/1.0 (https://github.com/github/copilot-cli)'
        }
      });
      if (!response.ok) {
        throw new Error(`Wikidata entity label lookup failed with ${response.status}`);
      }

      return response.json();
    })
  );

  const labels = new Map();

  for (const result of responses) {
    for (const [id, entity] of Object.entries(result.entities ?? {})) {
      const preferredLabel = entity.labels?.en
        ?? entity.labels?.fr
        ?? entity.labels?.de
        ?? entity.labels?.it
        ?? entity.labels?.nl
        ?? entity.labels?.es;
      if (preferredLabel?.value) {
        labels.set(id, preferredLabel.value);
      }
    }
  }

  return labels;
}

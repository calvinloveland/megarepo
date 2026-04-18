import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const baseCatalogPath = path.join(projectRoot, 'src', 'content', 'demo-content.json');
const supplementDir = path.join(projectRoot, 'src', 'content', 'artist-catalogs');
const targetTotalPerArtist = 100;
const preservedJsonFiles = new Set(['claude-monet.json']);
const artDescriptionKeywords = [
  'painter',
  'artist',
  'photographer',
  'printmaker',
  'illustrator',
  'architect',
  'sculptor',
  'designer',
  'engraver'
];

const baseCatalog = JSON.parse(await readFile(baseCatalogPath, 'utf8'));
const baseArtists = baseCatalog.artists;
const baseArtworks = baseCatalog.artworks;
const preservedSupplementalArtworks = (
  await Promise.all(
    Array.from(preservedJsonFiles).map(async (fileName) => JSON.parse(await readFile(path.join(supplementDir, fileName), 'utf8')))
  )
).flat();
const existingCounts = new Map();
const globalUsedSlugs = new Set([
  ...baseArtworks.map((artwork) => artwork.slug),
  ...preservedSupplementalArtworks.map((artwork) => artwork.slug)
]);

for (const artwork of baseArtworks) {
  existingCounts.set(artwork.artistSlug, (existingCounts.get(artwork.artistSlug) ?? 0) + 1);
}

await mkdir(supplementDir, { recursive: true });

for (const fileName of await readdir(supplementDir)) {
  if (fileName.endsWith('.json') && !preservedJsonFiles.has(fileName)) {
    await rm(path.join(supplementDir, fileName));
  }
}

const generationResults = [];

for (const artist of baseArtists) {
  if (artist.slug === 'claude-monet') {
    generationResults.push({ slug: artist.slug, fileName: 'claude-monet.json', generatedCount: 0, mode: 'preserved' });
    continue;
  }

  const existingCount = existingCounts.get(artist.slug) ?? 0;
  if (existingCount >= targetTotalPerArtist) {
    generationResults.push({ slug: artist.slug, fileName: null, generatedCount: 0, mode: 'already-deep' });
    continue;
  }

  const match = await resolveArtistEntity(artist.name);
  if (!match) {
    generationResults.push({ slug: artist.slug, fileName: null, generatedCount: 0, mode: 'unmatched' });
    continue;
  }

  const workRows = await fetchWorkRows(match.id, Math.max((targetTotalPerArtist - existingCount) * 2, 160));
  if (workRows.length === 0) {
    generationResults.push({ slug: artist.slug, fileName: null, generatedCount: 0, mode: 'no-works' });
    continue;
  }

  const looksArtRelated = match.description
    ? artDescriptionKeywords.some((keyword) => match.description.toLowerCase().includes(keyword))
    : true;
  if (!looksArtRelated && workRows.length < 10) {
    generationResults.push({ slug: artist.slug, fileName: null, generatedCount: 0, mode: 'non-art-match' });
    continue;
  }

  const titleMap = await fetchEntityLabels(
    workRows
      .map((row) => row.work?.value?.split('/').pop())
      .filter(Boolean)
  );
  const existingTitleKeys = new Set(
    baseArtworks
      .filter((artwork) => artwork.artistSlug === artist.slug)
      .map((artwork) => normalizeTitleKey(artwork.title))
  );
  const requiredNewWorks = Math.max(0, targetTotalPerArtist - existingCount);
  const generatedWorks = [];

  for (const row of workRows) {
    const qid = row.work?.value?.split('/').pop();
    if (!qid) {
      continue;
    }

    const title = titleMap.get(qid)?.trim();
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
    const slug = createUniqueSlug(title, year, qid, globalUsedSlugs);
    globalUsedSlugs.add(slug);

    generatedWorks.push({
      slug,
      title,
      artistSlug: artist.slug,
      movementSlug: artist.movementSlug,
      year,
      medium,
      dimensions: 'Not yet catalogued',
      tags: compact([
        'catalog record',
        'public domain',
        genre
      ]),
      summary: buildSummary(artist.name, title, year, genre)
    });

    if (generatedWorks.length >= requiredNewWorks) {
      break;
    }
  }

  if (!generatedWorks.length) {
    generationResults.push({ slug: artist.slug, fileName: null, generatedCount: 0, mode: 'no-generated-records' });
    continue;
  }

  const fileName = `${artist.slug}.json`;
  await writeFile(path.join(supplementDir, fileName), `${JSON.stringify(generatedWorks, null, 2)}\n`);
  generationResults.push({ slug: artist.slug, fileName, generatedCount: generatedWorks.length, mode: generatedWorks.length >= requiredNewWorks ? 'generated' : 'partial' });
}

await writeFile(path.join(supplementDir, 'index.ts'), `${buildIndexModule(generationResults)}\n`);

const generated = generationResults.filter((result) => result.mode === 'generated' || result.mode === 'partial');
const partial = generated.filter((result) => result.mode === 'partial');
console.log(`Generated supplements for ${generated.length} artists.`);
console.log(`Partial shortfalls: ${partial.length}.`);
console.log(
  JSON.stringify(
    generationResults.filter((result) => result.mode !== 'preserved' && result.mode !== 'already-deep'),
    null,
    2
  )
);

async function resolveArtistEntity(name) {
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    format: 'json',
    language: 'en',
    type: 'item',
    limit: '5',
    search: name,
    origin: '*'
  });
  const response = await fetch(`https://www.wikidata.org/w/api.php?${params.toString()}`, {
    headers: {
      'user-agent': 'megarepo-vernissage-catalog-bot/1.0 (https://github.com/github/copilot-cli)'
    }
  });
  if (!response.ok) {
    throw new Error(`Wikidata artist search failed for ${name} with ${response.status}`);
  }

  const payload = await response.json();
  return (payload.search ?? []).find((result) => {
    const labelMatch = normalizeTitleKey(result.label ?? '') === normalizeTitleKey(name);
    const aliasMatch = (result.aliases ?? []).some((alias) => normalizeTitleKey(alias) === normalizeTitleKey(name));
    return labelMatch || aliasMatch;
  });
}

async function fetchWorkRows(artistQid, limit) {
  const query = `
SELECT ?work ?inception
  (GROUP_CONCAT(DISTINCT ?materialLabel; separator=", ") AS ?materials)
  (GROUP_CONCAT(DISTINCT ?genreLabel; separator=", ") AS ?genres)
WHERE {
  ?work wdt:P170 wd:${artistQid}.
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
LIMIT ${limit}
`;

  const response = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, {
    headers: {
      'user-agent': 'megarepo-vernissage-catalog-bot/1.0 (https://github.com/github/copilot-cli)'
    }
  });
  if (!response.ok) {
    throw new Error(`Wikidata work query failed for ${artistQid} with ${response.status}`);
  }

  const payload = await response.json();
  return payload.results.bindings;
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

function normalizeTitleKey(title) {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function buildSummary(artistName, title, year, genre) {
  const qualifier = compact([
    year !== 'Date not yet catalogued' ? year : undefined,
    genre
  ]).join(' ');

  return qualifier
    ? `Catalog record for ${artistName}'s ${qualifier} work ${title}. Vernissage has added the piece to the dossier while a reusable image source and fuller curatorial notes are still being prepared.`
    : `Catalog record for ${artistName}'s ${title}. Vernissage has added the piece to the dossier while a reusable image source and fuller curatorial notes are still being prepared.`;
}

function buildIndexModule(results) {
  const fileNames = results
    .map((result) => result.fileName)
    .filter(Boolean)
    .sort();
  const imports = fileNames.map((fileName, index) => `import catalog${index} from './${fileName}';`).join('\n');
  const spread = fileNames.map((_, index) => `  ...catalog${index}`).join(',\n');

  return `${imports}\n\nexport const supplementalArtworks = [\n${spread}\n];`;
}

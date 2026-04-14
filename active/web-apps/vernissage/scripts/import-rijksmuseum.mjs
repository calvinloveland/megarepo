import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const apiKey = process.env.RIJKSMUSEUM_API_KEY;
const sampleSize = Number(process.env.RIJKS_SAMPLE_SIZE ?? '5');
const outputDir = path.resolve('data');

async function main() {
  if (!apiKey) {
    throw new Error('RIJKSMUSEUM_API_KEY is required to query the Rijksmuseum API.');
  }

  const url = new URL('https://www.rijksmuseum.nl/api/en/collection');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('q', 'art nouveau');
  url.searchParams.set('ps', String(sampleSize));
  url.searchParams.set('imgonly', 'True');

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Rijksmuseum API search failed: ${response.status}`);
  }

  const payload = await response.json();
  const artworks = (payload.artObjects ?? []).map((item) => ({
    objectNumber: item.objectNumber,
    title: item.title,
    principalOrFirstMaker: item.principalOrFirstMaker,
    longTitle: item.longTitle,
    image: item.webImage?.url ?? null,
    link: item.links?.web ?? null
  }));

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'rijksmuseum-sample.json'), JSON.stringify(artworks, null, 2));
  console.log(`Wrote ${artworks.length} Rijksmuseum artworks to data/rijksmuseum-sample.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

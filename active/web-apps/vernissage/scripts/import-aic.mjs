import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputDir = path.resolve('data');
const sampleSize = Number(process.env.AIC_SAMPLE_SIZE ?? '5');
const query = new URL('https://api.artic.edu/api/v1/artworks/search');
query.searchParams.set('q', 'art nouveau');
query.searchParams.set('limit', String(sampleSize));
query.searchParams.set('fields', 'id,title,artist_title,date_display,medium_display,image_id,place_of_origin');

async function main() {
  const response = await fetch(query);
  if (!response.ok) {
    throw new Error(`AIC API search failed: ${response.status}`);
  }

  const payload = await response.json();
  const artworks = (payload.data ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    artist: item.artist_title,
    date: item.date_display,
    medium: item.medium_display,
    placeOfOrigin: item.place_of_origin,
    image: item.image_id
      ? `https://www.artic.edu/iiif/2/${item.image_id}/full/843,/0/default.jpg`
      : null
  }));

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'aic-sample.json'), JSON.stringify(artworks, null, 2));
  console.log(`Wrote ${artworks.length} AIC artworks to data/aic-sample.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

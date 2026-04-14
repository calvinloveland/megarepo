import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputDir = path.resolve('data');
const sampleSize = Number(process.env.MET_SAMPLE_SIZE ?? '5');
const objectIdsUrl = 'https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=art%20nouveau';

async function main() {
  const response = await fetch(objectIdsUrl);
  if (!response.ok) {
    throw new Error(`Met API search failed: ${response.status}`);
  }

  const payload = await response.json();
  const ids = (payload.objectIDs ?? []).slice(0, sampleSize);
  const artworks = [];

  for (const id of ids) {
    const detailResponse = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
    if (!detailResponse.ok) {
      continue;
    }
    const detail = await detailResponse.json();
    artworks.push({
      id: detail.objectID,
      title: detail.title,
      artist: detail.artistDisplayName,
      date: detail.objectDate,
      medium: detail.medium,
      image: detail.primaryImageSmall,
      department: detail.department,
      culture: detail.culture
    });
  }

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'met-open-access-sample.json'), JSON.stringify(artworks, null, 2));
  console.log(`Wrote ${artworks.length} Met artworks to data/met-open-access-sample.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

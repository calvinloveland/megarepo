import type { Artwork } from '@/src/lib/catalog';

type ArtworkCatalogGroup = {
  label: string;
  works: Artwork[];
};

function getComparableYear(value: string) {
  const match = value.match(/\d{4}/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

function getDecadeLabel(value: string) {
  const match = value.match(/\d{4}/);
  if (!match) {
    return 'Date unknown';
  }

  const year = Number(match[0]);
  const decade = Math.floor(year / 10) * 10;
  return `${decade}s`;
}

export function sortCatalogWorks(works: Artwork[]) {
  return [...works].sort((left, right) => {
    const yearDiff = getComparableYear(left.year) - getComparableYear(right.year);
    if (yearDiff !== 0) {
      return yearDiff;
    }

    return left.title.localeCompare(right.title);
  });
}

export function groupCatalogWorksByDecade(works: Artwork[]): ArtworkCatalogGroup[] {
  const groups = new Map<string, Artwork[]>();

  for (const work of sortCatalogWorks(works)) {
    const label = getDecadeLabel(work.year);
    const bucket = groups.get(label) ?? [];
    bucket.push(work);
    groups.set(label, bucket);
  }

  return Array.from(groups.entries()).map(([label, groupedWorks]) => ({
    label,
    works: groupedWorks
  }));
}

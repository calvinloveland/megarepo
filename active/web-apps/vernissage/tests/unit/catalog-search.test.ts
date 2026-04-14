import test from 'node:test';
import assert from 'node:assert/strict';

import {
  maximizeArticImageUrl,
  resizeArticImageUrl,
  searchArtistsInCatalog,
  searchArtworksInCatalog,
  searchExhibitionsInCatalog
} from '../../src/lib/catalog-helpers.ts';

const movements = [
  { slug: 'impressionism', name: 'Impressionism' },
  { slug: 'post-impressionism', name: 'Post-Impressionism' }
];

const artists = [
  {
    slug: 'claude-monet',
    name: 'Claude Monet',
    movementSlug: 'impressionism',
    country: 'France',
    portraitLabel: 'Pond painter',
    bio: 'Monet studies water, light, and weather.',
    signatureMotifs: ['pond', 'light'],
    years: '1840–1926'
  },
  {
    slug: 'mary-cassatt',
    name: 'Mary Cassatt',
    movementSlug: 'impressionism',
    country: 'United States',
    portraitLabel: 'Intimate interiors',
    bio: 'Cassatt observes domestic life.',
    signatureMotifs: ['pastel', 'interior'],
    years: '1844–1926'
  }
];

const artworks = [
  {
    slug: 'water-lilies-1906',
    artistSlug: 'claude-monet',
    image: '/art/water-lilies.jpg',
    title: 'Water Lilies',
    movementSlug: 'impressionism',
    year: '1906',
    medium: 'Oil on canvas',
    summary: 'Reflections drift across a quiet pond.',
    tags: ['water lilies', 'pond', 'giverny']
  },
  {
    slug: 'mother-and-child',
    artistSlug: 'mary-cassatt',
    image: '/art/cassatt.jpg',
    title: 'Mother and Child',
    movementSlug: 'impressionism',
    year: '1890',
    medium: 'Oil on canvas',
    summary: 'A quiet domestic interior.',
    tags: ['interior']
  }
];

const venues = [{ slug: 'aic', name: 'Art Institute of Chicago', city: 'Chicago', country: 'United States' }];

const exhibitions = [
  {
    slug: 'light-and-color-revolution',
    title: 'Light and Color Revolution',
    venueSlug: 'aic',
    dateLabel: 'Spring 2026',
    artworkSlugs: ['water-lilies-1906'],
    description: 'A show about light, color, and perception.'
  }
];

const helpers = {
  getArtist: (slug: string) => artists.find((artist) => artist.slug === slug),
  getMovement: (slug: string) => movements.find((movement) => movement.slug === slug),
  getArtwork: (slug: string) => artworks.find((artwork) => artwork.slug === slug),
  getVenue: (slug: string) => venues.find((venue) => venue.slug === slug)
};

test('searchArtworks matches titles, artist names, and tags', () => {
  const byTitle = searchArtworksInCatalog(artworks, { query: 'water lilies' }, helpers);
  const byArtist = searchArtworksInCatalog(artworks, { query: 'monet' }, helpers);
  const byTag = searchArtworksInCatalog(artworks, { query: 'pond' }, helpers);

  assert.ok(byTitle.some((artwork) => artwork.slug === 'water-lilies-1906'));
  assert.ok(byArtist.some((artwork) => artwork.slug === 'water-lilies-1906'));
  assert.ok(byTag.some((artwork) => artwork.slug === 'water-lilies-1906'));
});

test('searchArtworks applies exact movement, medium, and year filters together', () => {
  const filtered = searchArtworksInCatalog(
    artworks,
    {
      movement: 'impressionism',
      medium: 'Oil on canvas',
      year: '1906'
    },
    helpers
  );

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.slug, 'water-lilies-1906');
});

test('searchArtists and searchExhibitions surface related launch catalog entities', () => {
  const artistMatches = searchArtistsInCatalog(artists, { query: 'cassatt' }, helpers);
  const exhibitionMatches = searchExhibitionsInCatalog(exhibitions, { query: 'light' }, helpers);

  assert.ok(artistMatches.some((artist) => artist.slug === 'mary-cassatt'));
  assert.ok(exhibitionMatches.some((exhibition) => exhibition.slug === 'light-and-color-revolution'));
});

test('Art Institute IIIF helpers keep thumbnails resized and artwork pages at max resolution', () => {
  const iiifImage = 'https://www.artic.edu/iiif/2/example-id/full/1400,/0/default.jpg';

  assert.equal(resizeArticImageUrl(iiifImage, 400), 'https://www.artic.edu/iiif/2/example-id/full/400,/0/default.jpg');
  assert.equal(maximizeArticImageUrl(iiifImage), 'https://www.artic.edu/iiif/2/example-id/full/max/0/default.jpg');
  assert.equal(maximizeArticImageUrl('/art/local-piece.jpg'), '/art/local-piece.jpg');
});

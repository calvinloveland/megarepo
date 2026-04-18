import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const contentPath = path.join(projectRoot, 'src', 'content', 'demo-content.json');
const baseContent = JSON.parse(await readFile(contentPath, 'utf8'));
const supplementalCatalogDir = path.join(projectRoot, 'src', 'content', 'artist-catalogs');
const supplementalCatalog = (
  await Promise.all(
    (await readdir(supplementalCatalogDir))
      .filter((fileName) => fileName.endsWith('.json'))
      .map(async (fileName) => JSON.parse(await readFile(path.join(supplementalCatalogDir, fileName), 'utf8')))
  )
).flat();
const content = {
  ...baseContent,
  artworks: [...baseContent.artworks, ...supplementalCatalog]
};

const artistSlugs = new Set(content.artists.map((artist) => artist.slug));
const artworkSlugs = new Set(content.artworks.map((artwork) => artwork.slug));
const exhibitionSlugs = new Set(content.exhibitions.map((exhibition) => exhibition.slug));
const visitSlugs = new Set(content.visits.map((visit) => visit.slug));
const venueSlugs = new Set(content.venues.map((venue) => venue.slug));
const memberHandles = new Set(content.members.map((member) => member.handle));
const listSlugs = new Set(content.lists.map((list) => list.slug));

function targetSet(targetType) {
  if (targetType === 'artwork') return artworkSlugs;
  if (targetType === 'artist') return artistSlugs;
  if (targetType === 'exhibition') return exhibitionSlugs;
  return visitSlugs;
}

test('featured highlights resolve to real entities', () => {
  for (const slug of content.site.highlights.featuredArtworkSlugs) {
    assert.ok(artworkSlugs.has(slug), `Missing featured artwork: ${slug}`);
  }
  for (const slug of content.site.highlights.featuredArtistSlugs) {
    assert.ok(artistSlugs.has(slug), `Missing featured artist: ${slug}`);
  }
  for (const slug of content.site.highlights.featuredExhibitionSlugs) {
    assert.ok(exhibitionSlugs.has(slug), `Missing featured exhibition: ${slug}`);
  }
  if (content.site.highlights.featuredListSlug) {
    assert.ok(listSlugs.has(content.site.highlights.featuredListSlug));
  }
  if (content.site.highlights.featuredMemberHandle) {
    assert.ok(memberHandles.has(content.site.highlights.featuredMemberHandle));
  }
});

test('artworks, exhibitions, lists, and reviews reference valid related records', () => {
  for (const artwork of content.artworks) {
    assert.ok(artistSlugs.has(artwork.artistSlug), `Artwork ${artwork.slug} has missing artist`);
    assert.ok(Array.isArray(artwork.tags) && artwork.tags.length > 0, `Artwork ${artwork.slug} should have tags`);
  }

  for (const exhibition of content.exhibitions) {
    assert.ok(venueSlugs.has(exhibition.venueSlug), `Exhibition ${exhibition.slug} has missing venue`);
    for (const artworkSlug of exhibition.artworkSlugs) {
      assert.ok(artworkSlugs.has(artworkSlug), `Exhibition ${exhibition.slug} references missing artwork ${artworkSlug}`);
    }
  }

  for (const visit of content.visits) {
    assert.ok(venueSlugs.has(visit.venueSlug), `Visit ${visit.slug} has missing venue`);
    assert.ok(memberHandles.has(visit.memberHandle), `Visit ${visit.slug} has missing member`);
  }

  for (const list of content.lists) {
    assert.ok(memberHandles.has(list.memberHandle), `List ${list.slug} has missing member`);
    for (const item of list.items) {
      assert.ok(artworkSlugs.has(item.artworkSlug), `List ${list.slug} references missing artwork ${item.artworkSlug}`);
    }
  }

  for (const member of content.members) {
    for (const followedHandle of member.followingHandles ?? []) {
      assert.ok(memberHandles.has(followedHandle), `Member ${member.handle} follows unknown handle ${followedHandle}`);
    }
  }

  for (const review of content.reviews) {
    assert.ok(memberHandles.has(review.memberHandle), `Review ${review.slug} has missing member`);
    assert.ok(targetSet(review.targetType).has(review.targetSlug), `Review ${review.slug} has invalid target ${review.targetSlug}`);
  }
});

test('assets referenced by artworks and ornaments exist', async () => {
  for (const artwork of content.artworks) {
    if (!artwork.image) {
      continue;
    }

    if (/^https:\/\//.test(artwork.image)) {
      const parsed = new URL(artwork.image);
      assert.equal(parsed.hostname, 'www.artic.edu', `Unexpected remote artwork host for ${artwork.slug}`);
      assert.match(parsed.pathname, /^\/iiif\/2\//, `Unexpected remote artwork path for ${artwork.slug}`);
      continue;
    }

    await access(path.join(projectRoot, 'public', artwork.image.replace(/^\//, '')));
  }

  const ornamentPaths = [
    'public/ornaments/corner-iris.svg',
    'public/ornaments/divider-vine.svg',
    'public/ornaments/hero-arch.svg',
    'public/ornaments/dropcap-lily.svg',
    'public/ornaments/paper-grain.svg'
  ];

  for (const ornamentPath of ornamentPaths) {
    await access(path.join(projectRoot, ornamentPath));
  }
});

test('feed entries reference valid members and local paths', () => {
  for (const item of content.feed) {
    assert.ok(memberHandles.has(item.memberHandle), `Feed item has unknown member ${item.memberHandle}`);
    assert.match(item.href, /^\//, `Feed item href must be local: ${item.href}`);
  }
});

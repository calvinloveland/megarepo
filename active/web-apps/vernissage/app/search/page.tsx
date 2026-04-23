import Link from 'next/link';
import { EnamelButton } from '@/src/components/EnamelButton';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { OpenFeedbackButton } from '@/src/components/OpenFeedbackButton';
import { ArtworkPreviewCard } from '@/src/components/ArtworkPreviewCard';
import { EnamelChip } from '@/src/components/EnamelChip';
import { GildedCard } from '@/src/components/GildedCard';
import { OrnateInput } from '@/src/components/OrnateInput';
import {
  artworks,
  getMovement,
  hasArtworkImage,
  movements,
  searchArtists,
  searchArtworks,
  searchExhibitions
} from '@/src/lib/catalog';
import { groupCatalogWorksByDecade } from '@/src/lib/catalog-records';

const mediums = Array.from(new Set(artworks.map((artwork) => artwork.medium))).sort((left, right) => left.localeCompare(right));
const years = Array.from(new Set(artworks.map((artwork) => artwork.year))).sort((left, right) => left.localeCompare(right));

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default async function SearchPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = firstValue(params.query).trim();
  const movement = firstValue(params.movement).trim();
  const medium = firstValue(params.medium).trim();
  const year = firstValue(params.year).trim();
  const hasFilters = Boolean(query || movement || medium || year);
  const artworkResults = searchArtworks({ query, movement, medium, year });
  const illustratedArtworkResults = artworkResults.filter(hasArtworkImage);
  const catalogOnlyArtworkResults = artworkResults.filter((artwork) => !hasArtworkImage(artwork));
  const visibleCatalogOnlyResults = hasFilters ? catalogOnlyArtworkResults : catalogOnlyArtworkResults.slice(0, 120);
  const catalogOnlyGroups = groupCatalogWorksByDecade(visibleCatalogOnlyResults);
  const artistResults = searchArtists({ query, movement });
  const exhibitionResults = searchExhibitions({ query, movement });
  const movementLabel = movement ? getMovement(movement)?.name ?? movement : '';

  return (
    <div className="page-stack">
      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">Explore what we&apos;ve catalogued</p>
        <h1>Search by movement, medium, or keyword</h1>
        <p>
          Start with a movement or a year when you want to narrow the room quickly. Keyword search reaches both
          illustrated works and deeper title-only records, so you can keep moving even when an image has not arrived yet.
        </p>
      </section>

      <section className="search-shell">
        <form className="ornate-form" method="GET">
          <OrnateInput
            label="Search term"
            name="query"
            placeholder="water, garden, seurat, gilded..."
            hint="Try an artist, title, motif, or place."
            defaultValue={query}
          />
          <OrnateInput
            label="Movement"
            name="movement"
            options={[{ value: '', label: 'Any movement' }, ...movements.map((movement) => ({ value: movement.slug, label: movement.name }))]}
            hint="The fastest way to narrow the room by style or period."
            defaultValue={movement}
          />
          <OrnateInput
            label="Medium"
            name="medium"
            options={[{ value: '', label: 'Any medium' }, ...mediums.map((medium) => ({ value: medium, label: medium }))]}
            hint="Painting, print, sculpture, or photography."
            defaultValue={medium}
          />
          <OrnateInput
            label="Year"
            name="year"
            options={[{ value: '', label: 'Any year' }, ...years.map((year) => ({ value: year, label: year }))]}
            hint="Useful when you know the exact work or phase."
            defaultValue={year}
          />
          <div className="button-row">
            <EnamelButton type="submit">Search catalog</EnamelButton>
            {hasFilters ? (
              <EnamelButton href="/search" variant="secondary">
                Clear filters
              </EnamelButton>
            ) : null}
          </div>
        </form>
      </section>

      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">
          {artworkResults.length} artwork match{artworkResults.length === 1 ? '' : 'es'}
        </p>
        <h2>{hasFilters ? 'Illustrated works first, deeper records below' : 'Start with the image wall, then go deeper'}</h2>
        <p>
          {hasFilters
            ? 'These results mix illustrated works with title-only research records. If the image wall looks thin, keep scrolling: the deeper catalog may still hold the page you need.'
            : 'This is the public catalog as it stands now. Begin with the illustrated works, then use filters whenever you want the deeper research records to do more of the work.'}
        </p>
        <div className="button-row">
          <EnamelButton href="/artists/new" variant="secondary">
            Suggest an artist
          </EnamelButton>
          <OpenFeedbackButton
            variant="secondary"
            initialText="I found an artwork missing from the Vernissage catalog and want to request it."
          >
            Request an artwork
          </OpenFeedbackButton>
        </div>
        <div className="chip-row">
          {query ? <EnamelChip tone="gold">Keyword: {query}</EnamelChip> : null}
          {movementLabel ? <EnamelChip tone="moss">Movement: {movementLabel}</EnamelChip> : null}
          {medium ? <EnamelChip tone="rose">Medium: {medium}</EnamelChip> : null}
          {year ? <EnamelChip tone="burgundy">Year: {year}</EnamelChip> : null}
        </div>
      </section>

      <BotanicalDivider label={hasFilters ? 'Illustrated matches' : 'Browse illustrated works'} />

      <section className="mosaic-grid">
        {illustratedArtworkResults.length ? (
          illustratedArtworkResults.map((artwork) => <ArtworkPreviewCard key={artwork.slug} artwork={artwork} />)
        ) : (
          <GildedCard title="No illustrated works match" eyebrow="Check the deeper records below">
            <p>
              {catalogOnlyArtworkResults.length ? (
                <>
                  We still found <strong>{catalogOnlyArtworkResults.length} deeper catalog record{catalogOnlyArtworkResults.length === 1 ? '' : 's'}</strong> for
                  this search below. If you were hoping for a fully illustrated page, keep scrolling or{' '}
                  <Link href="/artists/new" className="text-link">
                    suggest the missing artist directly
                  </Link>
                  .
                </>
              ) : (
                <>
                  This search did not turn up an illustrated work yet. Try a broader keyword, or{' '}
                  <Link href="/artists/new" className="text-link">
                    suggest the artist directly
                  </Link>{' '}
                  if the gap matters.
                </>
              )}
            </p>
          </GildedCard>
        )}
      </section>

      {catalogOnlyArtworkResults.length ? (
        <>
          <BotanicalDivider label="Deeper catalog records" />

          <section className="three-up-grid">
            {catalogOnlyGroups.map((group) => (
              <GildedCard key={group.label} title={group.label} eyebrow={`${group.works.length} record${group.works.length === 1 ? '' : 's'}`}>
                <ul className="plain-list">
                  {group.works.map((artwork) => (
                    <li key={artwork.slug}>
                      <Link href={`/artworks/${artwork.slug}`}>
                        {artwork.title}
                      </Link>{' '}
                      <span>({artwork.year})</span>
                    </li>
                  ))}
                </ul>
              </GildedCard>
            ))}
            {!hasFilters && catalogOnlyArtworkResults.length > visibleCatalogOnlyResults.length ? (
              <GildedCard
                title="More research records are waiting"
                eyebrow={`${catalogOnlyArtworkResults.length - visibleCatalogOnlyResults.length} additional records hidden by default`}
              >
                <p>Add a keyword, year, or medium filter to bring more of the deeper catalog into view.</p>
              </GildedCard>
            ) : null}
          </section>
        </>
      ) : null}

      {(query || movement) && artistResults.length ? (
        <>
          <BotanicalDivider label="Artists to keep exploring" />

          <section className="three-up-grid">
            {artistResults.slice(0, 6).map((artist, index) => (
              <GildedCard key={artist.slug} title={artist.name} eyebrow={getMovement(artist.movementSlug)?.name} href={`/artists/${artist.slug}`}>
                <p>{artist.portraitLabel}</p>
                <div className="chip-row chip-row--compact">
                  {artist.signatureMotifs.slice(0, 2).map((motif) => (
                    <EnamelChip key={motif} tone={index % 2 === 0 ? 'rose' : 'moss'}>
                      {motif}
                    </EnamelChip>
                  ))}
                </div>
              </GildedCard>
            ))}
          </section>
        </>
      ) : null}

      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">Still missing the name you need?</p>
        <h2>Nominate the next artist Vernissage should catalog</h2>
        <p>
          If search still leaves out the artist you want to write about, make the case directly. Strong requests tell us
          what gap they fill and which works would give members something real to discuss.
        </p>
        <div className="button-row">
          <EnamelButton href="/artists/new">Nominate an artist</EnamelButton>
        </div>
      </section>

      {(query || movement) && exhibitionResults.length ? (
        <>
          <BotanicalDivider label="Exhibitions for context" />

          <section className="two-up-grid">
            {exhibitionResults.slice(0, 4).map((exhibition) => (
              <GildedCard key={exhibition.slug} title={exhibition.title} eyebrow={exhibition.dateLabel} href={`/exhibitions/${exhibition.slug}`}>
                <p>{exhibition.description}</p>
              </GildedCard>
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}

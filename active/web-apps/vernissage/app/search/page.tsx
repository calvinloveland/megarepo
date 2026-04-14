import { EnamelButton } from '@/src/components/EnamelButton';
import { BotanicalDivider } from '@/src/components/BotanicalDivider';
import { OpenFeedbackButton } from '@/src/components/OpenFeedbackButton';
import { EnamelChip } from '@/src/components/EnamelChip';
import { GildedCard } from '@/src/components/GildedCard';
import { OrnateInput } from '@/src/components/OrnateInput';
import {
  artworks,
  getArtist,
  getArtworkThumbnail,
  getMovement,
  movements,
  searchArtists,
  searchArtworks,
  searchExhibitions
} from '@/src/lib/catalog';

const mediums = Array.from(new Set(artworks.map((artwork) => artwork.medium)));
const years = Array.from(new Set(artworks.map((artwork) => artwork.year)));

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
  const artistResults = searchArtists({ query, movement });
  const exhibitionResults = searchExhibitions({ query, movement });
  const movementLabel = movement ? getMovement(movement)?.name ?? movement : '';

  return (
    <div className="page-stack">
      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">Launch catalog</p>
        <h1>Search the current curated collection</h1>
        <p>
          Filter the artworks we have actually published for launch by movement, medium, year, or keyword. Community reviews
          appear on detail pages as they are published.
        </p>
      </section>

      <section className="search-shell">
        <form className="ornate-form" method="GET">
          <OrnateInput label="Search term" name="query" placeholder="water, garden, seurat, gilded..." defaultValue={query} />
          <OrnateInput
            label="Movement"
            name="movement"
            options={[{ value: '', label: 'Any movement' }, ...movements.map((movement) => ({ value: movement.slug, label: movement.name }))]}
            defaultValue={movement}
          />
          <OrnateInput
            label="Medium"
            name="medium"
            options={[{ value: '', label: 'Any medium' }, ...mediums.map((medium) => ({ value: medium, label: medium }))]}
            defaultValue={medium}
          />
          <OrnateInput
            label="Year"
            name="year"
            options={[{ value: '', label: 'Any year' }, ...years.map((year) => ({ value: year, label: year }))]}
            defaultValue={year}
          />
          <div className="button-row">
            <EnamelButton type="submit">Apply filters</EnamelButton>
            {hasFilters ? (
              <EnamelButton href="/search" variant="secondary">
                Clear filters
              </EnamelButton>
            ) : null}
          </div>
        </form>
      </section>

      <section className="hero-shell hero-shell--compact">
        <p className="eyebrow">{artworkResults.length} matching artworks</p>
        <h2>{hasFilters ? 'Filtered results' : 'Full launch catalog'}</h2>
        <p>
          {hasFilters
            ? 'These results come directly from the published launch catalog rather than a placeholder search UI.'
            : 'You are viewing the full launch catalog. Add a keyword or filter to narrow the room.'}
        </p>
        <div className="button-row">
          <EnamelButton href="/artists/new" variant="secondary">
            Suggest an artist
          </EnamelButton>
          <OpenFeedbackButton
            variant="secondary"
            initialText="I'd love to request an artwork that is missing from the Vernissage catalog."
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

      <BotanicalDivider label={hasFilters ? 'Matching artworks' : 'Browse constellations'} />

      <section className="mosaic-grid">
        {artworkResults.length ? (
          artworkResults.map((artwork) => {
            const artist = getArtist(artwork.artistSlug);
            return (
              <GildedCard
                key={artwork.slug}
                title={artwork.title}
                eyebrow={artist?.name ?? artwork.year}
                subtitle={`${artwork.year} · ${artwork.medium}`}
                href={`/artworks/${artwork.slug}`}
                thumbnail={{ src: getArtworkThumbnail(artwork, 400), alt: artwork.title, width: 400, height: 267 }}
              >
                <p>{artwork.summary}</p>
                <div className="chip-row chip-row--compact">
                  {artwork.tags.slice(0, 3).map((tag, index) => (
                    <EnamelChip key={tag} tone={index === 1 ? 'moss' : 'gold'}>
                      {tag}
                    </EnamelChip>
                  ))}
                </div>
              </GildedCard>
            );
          })
        ) : (
          <GildedCard title="No matching artworks" eyebrow="Adjust the current filters">
            <p>Try broadening the keyword, clearing one of the exact filters, or browsing the full launch catalog again.</p>
          </GildedCard>
        )}
      </section>

      {(query || movement) && artistResults.length ? (
        <>
          <BotanicalDivider label="Related artists" />

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
        <p className="eyebrow">Missing someone important?</p>
        <h2>Suggest the next artist we should catalog</h2>
        <p>
          If the current search still leaves out the artist you want to write about, send a direct
          artist request instead of burying it in a generic feedback note.
        </p>
        <div className="button-row">
          <EnamelButton href="/artists/new">Open artist request form</EnamelButton>
        </div>
      </section>

      {(query || movement) && exhibitionResults.length ? (
        <>
          <BotanicalDivider label="Related exhibitions" />

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

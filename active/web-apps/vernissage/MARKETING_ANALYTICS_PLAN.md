# Vernissage marketing and analytics growth plan

## Goal

Turn artist discovery into a repeatable growth loop: people arrive for a specific artist or artwork, create an account to save their taste publicly, and come back because other members' favorites, follows, and reviews keep the catalog feeling alive.

## Positioning

Vernissage should present itself as:

- the Letterboxd-for-art feeling, without pretending to be a social network first
- a place for deep artist discovery, not just museum-label summaries
- a public taste graph where favorites, follows, and reviews create visible paths through the catalog

## Core promise

If someone cares enough about an artist to search for them, Vernissage should give them three reasons to stay:

1. a deeper dossier than a typical search result
2. visible signals from other people who care about the same work
3. an easy path to start building a public collection of taste

## Priority audiences

1. Art-history hobbyists and museum regulars
2. Letterboxd, Goodreads, and rate-your-taste users looking for a visual-art equivalent
3. People searching for specific artists, movements, and works
4. Teachers, student groups, and small curator-led communities

## North-star metrics

The product is healthy when discovery leads to public taste-building, so the primary metrics should be:

1. join completions
2. first favorite within the first session
3. first follow within the first two sessions
4. first review within the first 14 days
5. returning signed-in members within 7 days

Secondary metrics:

- search-to-detail clickthrough
- artist-view to join conversion
- artwork-view to favorite conversion
- follow-to-return correlation
- top artists and artworks by favorite, follow-adjacent, and review activity

## Growth strategy

### 1. Win search with deep artist pages

The catalog is now a real acquisition surface. Use it like one.

- Treat artist and artwork pages as the top-of-funnel landing pages
- Prioritize artists with enough depth to feel materially better than a generic museum snippet
- Keep publishing catalog expansions that create a simple public hook:
  - "Monet now has 1,000 catalogued works"
  - "Browse 100 works from [artist]"
  - "Go beyond the greatest hits for [artist]"
- Build editorial support around high-intent artist searches, especially:
  - where to start with an artist
  - overlooked works by an artist
  - how an artist changed over time
  - best entry points into a movement

### 2. Make public taste the differentiator

Traffic alone will not make Vernissage memorable. Public activity is the moat.

- Show favorites, follows, and reviews as proof that the catalog is inhabited
- Highlight member shelves and review excerpts in marketing copy and social posts
- Treat "follow someone whose taste you like" as a core activation step, not a side feature
- Encourage review writing as lightweight publishing, not homework

### 3. Use editorial as both acquisition and activation

CuratorBot-style content should not be random blogging. It should move people deeper into the product.

- Publish short editorial pieces tied to pages already in the catalog
- Link every editorial post into a relevant artist or artwork path
- End posts with a product action:
  - favorite this artist
  - browse related works
  - follow a member with similar taste
  - write your own review

### 4. Seed communities instead of chasing broad social reach

Early marketing should go where people already discuss artists seriously.

- art-history Discords
- museum and exhibition communities
- Reddit threads with real artist-specific intent
- classroom and reading-group style communities
- niche newsletters or blogs that like discovery tools

The goal is not mass awareness yet. The goal is to get the right people to create visible activity on the site.

## Campaign pillars

### 1. Deep dossier launches

Use major catalog expansions as marketable moments.

Examples:

- "Monet beyond the canon: 1,000 works in one dossier"
- "58 artists now have deep catalogs"
- "Browse entire periods of an artist, not just the famous three"

### 2. Taste trail spotlights

Show how public behavior creates discovery.

Examples:

- a member's favorite impressionist trail
- three members who love different versions of modernism
- a review-led path through one artist's catalog

### 3. Editorial answer posts

Answer the kinds of questions people already search for.

Examples:

- where to start with Paul Cezanne
- best Monet works beyond Water Lilies
- overlooked surrealist paintings worth your time

### 4. Timely cultural hooks

Tie releases to museum shows, anniversaries, or seasonal spikes in attention, then route that attention into evergreen artist pages.

## Funnel and analytics plan

Use first-party analytics only. Avoid third-party adtech and avoid collecting freeform personal text beyond what the product already stores for feedback and reviews.

### Events already captured

- `page_view`
- `search_performed`
- `artist_viewed`
- `artwork_viewed`
- `join_started`
- `join_completed`
- `signin_started`
- `signin_completed`
- `favorite_artist`
- `favorite_artwork`
- `follow_member`
- `review_started`
- `review_submitted`
- `feedback_submitted`

### Core funnels to watch

1. Discovery funnel
   - landing page or search entry
   - artist or artwork detail view
   - join started
   - join completed

2. Activation funnel
   - join completed
   - first favorite
   - first follow
   - first review

3. Retention funnel
   - first signed-in session
   - second signed-in session within 7 days
   - review submitted within 14 days

### Weekly dashboard

Track these every week:

- total events
- unique sessions
- unique signed-in members
- join completions
- sign-in completions
- review submissions
- favorite events
- follow events
- top page types
- top paths
- top artists and artworks by tracked activity
- discovery pages with strong conversion to join
- activation steps with the largest drop-off

## Operating cadence

### Weekly

1. Pick one artist cluster, movement, or editorial question to spotlight
2. Publish one catalog or editorial hook
3. Share it in one or two high-intent communities
4. Review the analytics summary and note:
   - which paths drew visits
   - which paths converted to joins
   - which artists drove favorites, follows, and reviews

### Monthly

1. Double down on the artist pages that convert
2. Refresh or replace the campaigns that drive traffic but no activation
3. Publish a simple "what's new on Vernissage" update that bundles:
   - new deep dossiers
   - notable reviews
   - new public taste trails

## Immediate execution plan

### Phase 1: prove the core loop

- Push people from discovery into account creation
- Measure which artist and artwork pages produce the highest join rate
- Identify the first pages that reliably produce favorites and follows

### Phase 2: amplify what converts

- Turn the best-performing artists into recurring editorial and social themes
- Publish comparison posts and starter guides for those artists
- Feature members or reviews that deepen the same discovery path

### Phase 3: build retention surfaces

- Add a lightweight recurring product update or digest
- Highlight activity from followed members
- Use new review and favorite activity as reasons to return

## Experiment backlog

1. "Start here" modules on top artist pages
2. review prompts on artwork pages after favoriting
3. homepage modules that feature active member taste trails
4. editorial landing pages for movements and periods
5. shareable member profile sections centered on favorites and reviews

## Guardrails

- Keep analytics first-party and privacy-light
- Do not log keystrokes or draft review text
- Prefer counts, paths, and catalog targets over invasive behavioral profiling
- Treat reviews, favorites, and follows as the main product-health signals
- Optimize for authentic art-interest communities, not generic growth spam

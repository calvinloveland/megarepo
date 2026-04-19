# Vernissage marketing and user analytics plan

## Goal

Turn curious visitors into returning reviewers by making artist discovery, public taste signals, and publishing feel like one connected loop.

## Positioning

Vernissage should present itself as:

- a social art-review salon rather than a static museum catalog
- a place for deep artist discovery, not just canonical greatest hits
- a product where favorites, follows, and reviews create visible taste trails

## Priority audiences

1. Art-history hobbyists and museum regulars
2. Letterboxd/Goodreads-style collectors who want a visual-art equivalent
3. People searching for specific artists, movements, or works
4. Small curator, classroom, and art-community groups

## Marketing channels

### 1. SEO and editorial discovery

- Let artist and artwork pages do the long-tail acquisition work
- Publish regular CuratorBot-style editorial posts tied to specific artists, movements, and catalog expansions
- Create recurring themes such as:
  - where to start with an artist
  - best works by an artist
  - overlooked works in a movement
  - newly expanded artist dossiers

### 2. Social proof and sharing

- Share image-led artist threads and review excerpts
- Highlight public favorites and follows as signs of living community activity
- Announce major catalog expansions in simple product language such as:
  - “Monet now has 1,000 catalogued works”
  - “58 artists now have deep dossiers”

### 3. Community outreach

- Share selectively in museum-study groups, art-history communities, Discords, Reddit threads, and newsletters
- Focus early outreach on artist pages that already have enough depth to feel impressive on first visit

### 4. Retention later

- Weekly digest or product update summarizing:
  - new reviews
  - newly deepened artist dossiers
  - new follows
  - new favorites from people a member follows

## Core analytics implementation

Use first-party analytics only. Avoid third-party adtech and avoid collecting freeform personal text beyond what the product already stores for feedback and reviews.

### Events to capture

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

### Key funnels

1. Discovery
   - landing page
   - search
   - artist or artwork detail
   - join or sign-in

2. Social activation
   - account created
   - first favorite
   - first follow
   - first review

3. Retention
   - first session
   - second session inside 7 days
   - first review inside 14 days

## Weekly dashboard

Track these every week:

- total events
- unique sessions
- unique signed-in members
- top event counts
- top page types
- top paths
- top artists or artworks by tracked actions
- join completions
- sign-in completions
- review submissions
- favorite events
- follow events

## Operating loop

1. Expand or spotlight one artist cluster each week
2. Publish a post or social thread tied to that cluster
3. Watch whether the new pages produce favorites, follows, and reviews
4. Use that demand to choose the next catalog-expansion wave

## Guardrails

- Keep analytics first-party and privacy-light
- Do not log keystrokes or draft review text
- Prefer counts, paths, and catalog targets over invasive behavioral profiling
- Treat reviews, favorites, and follows as the main product-health signals

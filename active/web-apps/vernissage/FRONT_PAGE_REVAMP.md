The Vernissage — Landing Page Design Spec
0. Goal

Create a landing page that:

Immediately communicates: “track, rate, and catalog art”
Feels like a curated art object, not a SaaS dashboard
Uses art deco visual language to differentiate
Drives 2 actions:
Sign up
Explore content
1. Core Positioning (non-negotiable)

Primary message:

Track the art you love.

Secondary:

Discover, rate, and catalog artworks, exhibitions, and artists.

Mental model:

Letterboxd for art
Goodreads for art
2. Visual System (Art Deco)
Color Palette
--bg-primary: #0B0F0E;        /* near-black green */
--bg-secondary: #111716;
--gold-primary: #C6A86B;
--gold-bright: #E0C48A;
--cream: #EDE6D6;
--muted-text: #A8A39A;
--card-bg: #121817;
--border-gold: rgba(198,168,107,0.4);
Typography
Headings: High-contrast serif
Suggested: Playfair Display / Cormorant / Libre Baskerville
Body: Elegant readable serif or humanist sans
Suggested: Inter / Source Sans / EB Garamond
Type Scale
h1: 64–80px
h2: 36–44px
h3: 22–28px
body: 16–18px
small: 14px
Decorative Elements (important)
Thin gold borders
Symmetry
Corner ornaments (SVG)
Subtle geometric dividers
Frame-like containers
3. Layout Overview
[ NAVBAR ]
[ HERO (split: text + image + UI card) ]
[ VALUE STRIP (4 columns) ]
[ EXPLORE GRID ]
[ COMMUNITY CTA ]
[ FOOTER ]

Max width: 1200–1300px
Gutters: 24–32px
Spacing rhythm: 8px base

4. Navbar
Structure

Left:

Logo: THE VERNISSAGE
Small tagline (optional): “A social catalog for art”

Center:

Discover
Diary
Lists
Artists
Exhibitions

Right:

Log in (ghost button)
Sign up (primary button)
Style
Transparent over hero
Gold text
Thin bottom border on scroll
5. Hero Section (MOST IMPORTANT)
Layout

2-column:

Left: text + CTAs
Right: artwork image with overlay card
Left Content

H1

Track the art you love.

Subtext

Discover, rate, and catalog artworks, exhibitions, and artists.

Buttons

Primary: Sign up for free
Secondary: Explore the community
Right Content (CRITICAL — SHOW PRODUCT)

Large classical painting image with overlay:

“Logged Artwork Card” (this is the hook)
[ Artwork thumbnail ]
Title: Water Lilies
Artist: Claude Monet

Seen at: MoMA
Date: May 2

Rating: ★★★★☆
Status: Logged
Card Style
background: rgba(18,24,23,0.9);
border: 1px solid var(--border-gold);
backdrop-blur: 8px;
padding: 16px;
border-radius: 8px;
6. Value Strip (4 columns)
Items
Track what you love
Catalog artworks and exhibitions
See what others love
Follow people, discover taste
Share your voice
Rate and review art
Curate your lists
Build collections and themes
Style
Cream background section
Gold dividers between columns
Minimal icons (line + deco style)
7. Explore Section
Header

Explore The Vernissage
Right side: “View all →”

Grid (4 cards)

Each card includes:

Image
Label (small caps)
Title
Metadata
Card Types
Trending List
“Iconic Paintings of the 20th Century”
Artist Spotlight
“Frida Kahlo”
Exhibition
“Infinity Mirror Rooms”
Review
“Michelangelo: The Eternal Genius”
Card Style
border: 1px solid var(--border-gold);
background: var(--card-bg);
border-radius: 10px;
overflow: hidden;

Hover:

Slight scale (1.02)
Border brightens
8. Community CTA Section
Layout

Split:

Left: illustration (art deco figure or frame)
Right: text + input
Copy

Headline

Join a community that catalogs art.

Subtext

Build your profile, track what you’ve seen, and discover new work.

Input
Email field
“Sign up for free” button
9. Footer
Columns
Brand
Explore
Community
Company
Include
Logo mark (monogram “V” in deco frame)
Social icons
Copyright
10. Interaction Design
Hover States
Gold brightens
Subtle glow
Underlines animate
Buttons

Primary:

background: var(--gold-primary);
color: black;

Secondary:

border: 1px solid var(--gold-primary);
color: var(--gold-primary);
11. Responsiveness
Mobile

Stack order:

Hero text
Hero image + card
Value strip (2x2 grid)
Explore (horizontal scroll)
CTA
Footer
Breakpoints
sm: 640px
md: 768px
lg: 1024px
xl: 1280px
12. Assets Needed
4–8 high-quality artwork images
1 hero painting
Optional: art deco SVG ornaments
Avatar placeholders
13. Nice-to-Have Enhancements
Subtle film grain texture overlay
Parallax on hero image
Animated star rating (hover fill)
“Recently logged by users” ticker
14. Anti-Goals (avoid this)
Generic SaaS gradients
Bright modern blues/purples
Overly minimal white UI
Long paragraphs
अस्प vague marketing copy
15. Success Criteria

User lands → within 3 seconds understands:

“Oh, I can track and rate art like Letterboxd.”

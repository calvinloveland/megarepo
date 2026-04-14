import type { MetadataRoute } from 'next';

import { artists, artworks, artworkLists, exhibitions } from '@/src/lib/catalog';

const baseUrl = 'https://vernissage.shsw.dev';

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = ['', '/feed', '/search', '/reviews/new', '/join', '/signin', '/privacy', '/terms', '/contact', '/artists/new'];
  const dynamicRoutes = [
    ...artworks.map((item) => `/artworks/${item.slug}`),
    ...artists.map((item) => `/artists/${item.slug}`),
    ...exhibitions.map((item) => `/exhibitions/${item.slug}`),
    ...artworkLists.map((item) => `/lists/${item.slug}`)
  ];

  return [...staticRoutes, ...dynamicRoutes].map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === '' ? 'daily' : 'weekly',
    priority: route === '' ? 1 : 0.7
  }));
}

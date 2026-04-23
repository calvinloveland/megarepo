import type { MetadataRoute } from 'next';

import { resolveSiteUrl } from '@/src/lib/site-url';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = resolveSiteUrl(process.env.NEXTAUTH_URL);

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/feedback']
    },
    sitemap: `${baseUrl}/sitemap.xml`
  };
}

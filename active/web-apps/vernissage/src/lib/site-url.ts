const DEFAULT_SITE_URL = 'https://thevernissage.art';

export function resolveSiteUrl(rawUrl: string | null | undefined): string {
  const trimmedUrl = rawUrl?.trim();

  if (!trimmedUrl) {
    return DEFAULT_SITE_URL;
  }

  return trimmedUrl.endsWith('/') ? trimmedUrl.slice(0, -1) : trimmedUrl;
}

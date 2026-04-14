export type ReviewTargetType = 'artwork' | 'artist' | 'exhibition' | 'visit';
export type PrismaReviewTargetType = 'ARTWORK' | 'ARTIST' | 'EXHIBITION' | 'VISIT';

export type ParsedTag = {
  slug: string;
  name: string;
};

export type ReviewSubmission = {
  targetType: ReviewTargetType;
  targetSlug: string;
  title: string;
  body: string;
  excerpt: string;
  spoiler: boolean;
  rating: number;
  tags: ParsedTag[];
};

export const reviewTargetTypeMap: Record<ReviewTargetType, PrismaReviewTargetType> = {
  artwork: 'ARTWORK',
  artist: 'ARTIST',
  exhibition: 'EXHIBITION',
  visit: 'VISIT'
};

export function normalizeHandle(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
}

export function slugify(value: string) {
  return normalizeHandle(value);
}

export function buildReviewExcerpt(body: string, limit: number = 220) {
  const compact = body.replace(/\s+/g, ' ').trim();
  if (compact.length <= limit) {
    return compact;
  }

  const candidate = compact.slice(0, limit);
  const lastSpace = candidate.lastIndexOf(' ');
  return `${candidate.slice(0, lastSpace > 120 ? lastSpace : limit).trimEnd()}…`;
}

export function parseReviewTags(rawTags: string) {
  const seen = new Set<string>();

  return rawTags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((name) => ({ slug: slugify(name), name: name.toLowerCase() }))
    .filter((tag) => {
      if (!tag.slug || seen.has(tag.slug)) {
        return false;
      }
      seen.add(tag.slug);
      return true;
    });
}

export function parseReviewSubmission(
  formData: FormData,
  allowedTargets: Record<ReviewTargetType, Set<string>>
): { ok: true; value: ReviewSubmission } | { ok: false; error: string } {
  const targetType = `${formData.get('targetType') ?? ''}`.trim() as ReviewTargetType;
  const targetSlug = `${formData.get('targetSlug') ?? ''}`.trim();
  const title = `${formData.get('title') ?? ''}`.trim();
  const body = `${formData.get('body') ?? ''}`.trim();
  const spoiler = `${formData.get('spoiler') ?? 'no'}` === 'yes';
  const rating = Number.parseFloat(`${formData.get('rating') ?? ''}`);
  const tags = parseReviewTags(`${formData.get('tags') ?? ''}`);

  if (!Object.hasOwn(reviewTargetTypeMap, targetType)) {
    return { ok: false, error: 'Choose a valid review target type.' };
  }

  if (!allowedTargets[targetType]?.has(targetSlug)) {
    return { ok: false, error: 'Choose a valid catalogue entry.' };
  }

  if (title.length < 4 || title.length > 120) {
    return { ok: false, error: 'Review titles must be between 4 and 120 characters.' };
  }

  if (body.length < 40 || body.length > 5000) {
    return { ok: false, error: 'Reviews must be between 40 and 5000 characters.' };
  }

  if (!Number.isFinite(rating) || rating < 0.5 || rating > 5) {
    return { ok: false, error: 'Choose a rating between 0.5 and 5 stars.' };
  }

  return {
    ok: true,
    value: {
      targetType,
      targetSlug,
      title,
      body,
      excerpt: buildReviewExcerpt(body),
      spoiler,
      rating,
      tags
    }
  };
}

export function buildReviewSlug(targetSlug: string, title: string) {
  return `${targetSlug}-${slugify(title)}-${Date.now().toString(36)}`;
}

export function getReviewTargetHref(targetType: ReviewTargetType, targetSlug: string) {
  if (targetType === 'artwork') return `/artworks/${targetSlug}`;
  if (targetType === 'artist') return `/artists/${targetSlug}`;
  if (targetType === 'exhibition') return `/exhibitions/${targetSlug}`;
  return '/reviews/new';
}

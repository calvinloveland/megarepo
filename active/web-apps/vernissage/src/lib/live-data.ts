import type { Review as CatalogReview } from '@/src/lib/catalog';
import { getPrisma, isDatabaseConfigured } from '@/src/lib/prisma';
import { reviewTargetTypeMap, type ReviewTargetType } from '@/src/lib/review-submission';

export type DatabaseMemberProfile = {
  handle: string;
  displayName: string;
  bio: string;
  location: string;
  favoriteMovement: string;
  stats: {
    reviews: number;
    lists: number;
    following: number;
  };
};

function toCatalogReview(review: any): CatalogReview {
  return {
    slug: review.slug,
    targetType: review.targetType.toLowerCase() as ReviewTargetType,
    targetSlug: review.targetSlug,
    memberHandle: review.user.handle,
    title: review.title,
    excerpt: review.excerpt ?? review.body,
    rating: review.ratingValue ?? 0,
    publishedOn: review.publishedAt.toISOString().slice(0, 10),
    tags: review.reviewTags.map((entry: any) => entry.tag.name)
  };
}

export async function getPersistedReviewsForTarget(targetType: ReviewTargetType, targetSlug: string) {
  if (!isDatabaseConfigured()) {
    return [] as CatalogReview[];
  }

  const prisma = getPrisma();
  const reviews = await prisma.review.findMany({
    where: {
      targetType: reviewTargetTypeMap[targetType],
      targetSlug
    },
    include: {
      user: true,
      reviewTags: {
        include: {
          tag: true
        }
      }
    },
    orderBy: {
      publishedAt: 'desc'
    }
  });

  return reviews.map(toCatalogReview);
}

export async function getPersistedReviewsByMember(handle: string) {
  if (!isDatabaseConfigured()) {
    return [] as CatalogReview[];
  }

  const prisma = getPrisma();
  const reviews = await prisma.review.findMany({
    where: {
      user: {
        handle
      }
    },
    include: {
      user: true,
      reviewTags: {
        include: {
          tag: true
        }
      }
    },
    orderBy: {
      publishedAt: 'desc'
    }
  });

  return reviews.map(toCatalogReview);
}

export async function getPersistedRecentReviews(limit: number = 10) {
  if (!isDatabaseConfigured()) {
    return [] as CatalogReview[];
  }

  const prisma = getPrisma();
  const reviews = await prisma.review.findMany({
    take: limit,
    include: {
      user: true,
      reviewTags: {
        include: {
          tag: true
        }
      }
    },
    orderBy: {
      publishedAt: 'desc'
    }
  });

  return reviews.map(toCatalogReview);
}

export async function getPersistedMemberProfile(handle: string) {
  if (!isDatabaseConfigured()) {
    return null;
  }

  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { handle },
    include: {
      _count: {
        select: {
          authoredReviews: true,
          lists: true,
          following: true
        }
      }
    }
  });

  if (!user) {
    return null;
  }

  return {
    handle: user.handle,
    displayName: user.name?.trim() || user.handle,
    bio: user.bio?.trim() || '',
    location: user.location?.trim() || '',
    favoriteMovement: user.favoriteMovement?.trim() || '',
    stats: {
      reviews: user._count.authoredReviews,
      lists: user._count.lists,
      following: user._count.following
    }
  } satisfies DatabaseMemberProfile;
}

export function mergeReviews(staticReviews: CatalogReview[], liveReviews: CatalogReview[]) {
  return [...liveReviews, ...staticReviews].sort((left, right) => right.publishedOn.localeCompare(left.publishedOn));
}

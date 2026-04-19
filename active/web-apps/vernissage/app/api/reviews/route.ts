import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { artists, artworks, exhibitions, visits } from '@/src/lib/catalog';
import { recordAnalyticsEvent } from '@/src/lib/analytics';
import { authOptions } from '@/src/lib/auth';
import { getPrisma, isDatabaseConfigured } from '@/src/lib/prisma';
import { rateLimitHeaders, takeRateLimitHit } from '@/src/lib/rate-limit';
import {
  buildReviewSlug,
  getReviewTargetHref,
  parseReviewSubmission,
  reviewTargetTypeMap,
  type ReviewTargetType
} from '@/src/lib/review-submission';

const allowedTargets: Record<ReviewTargetType, Set<string>> = {
  artwork: new Set(artworks.map((item) => item.slug)),
  artist: new Set(artists.map((item) => item.slug)),
  exhibition: new Set(exhibitions.map((item) => item.slug)),
  visit: new Set(visits.map((item) => item.slug))
};
const REVIEW_WINDOW_MS = 15 * 60 * 1000;
const REVIEW_POST_LIMIT = 5;

function redirectTo(request: Request, path: string, params: Record<string, string>) {
  const requestUrl = new URL(request.url);
  const url = new URL(path, requestUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return redirectTo(request, '/signin', { callbackUrl: '/reviews/new' });
  }

  if (!isDatabaseConfigured()) {
    return redirectTo(request, '/reviews/new', { error: 'database-unavailable' });
  }

  const formData = await request.formData();
  const parsed = parseReviewSubmission(formData, allowedTargets);
  if (!parsed.ok) {
    return redirectTo(request, '/reviews/new', { error: parsed.error });
  }

  const submission = parsed.value;
  const prisma = getPrisma();
  const rateLimit = takeRateLimitHit(`reviews:${session.user.id}`, REVIEW_POST_LIMIT, REVIEW_WINDOW_MS);
  if (!rateLimit.ok) {
    const response = redirectTo(request, '/reviews/new', { error: 'rate-limited' });
    for (const [name, value] of Object.entries(rateLimitHeaders(rateLimit))) {
      response.headers.set(name, value);
    }
    return response;
  }

  const targetType = reviewTargetTypeMap[submission.targetType];
  const existingReview = await prisma.review.findFirst({
    where: {
      userId: session.user.id,
      targetType,
      targetSlug: submission.targetSlug
    },
    select: {
      id: true
    }
  });
  if (existingReview) {
    return redirectTo(request, '/reviews/new', { error: 'already-reviewed' });
  }

  const review = await prisma.review.create({
    data: {
      slug: buildReviewSlug(submission.targetSlug, submission.title),
      title: submission.title,
      body: submission.body,
      excerpt: submission.excerpt,
      spoiler: submission.spoiler,
      ratingValue: submission.rating,
      targetType,
      targetSlug: submission.targetSlug,
      userId: session.user.id,
      reviewTags: {
        create: submission.tags.map((tag) => ({
          tag: {
            connectOrCreate: {
              where: {
                slug: tag.slug
              },
              create: {
                slug: tag.slug,
                name: tag.name
              }
            }
          }
        }))
      }
    }
  });

  await prisma.rating.create({
    data: {
      value: submission.rating,
      targetType,
      targetSlug: submission.targetSlug,
      userId: session.user.id
    }
  });

  await recordAnalyticsEvent({
    eventType: 'review_submitted',
    pageType: 'review-compose',
    path: '/reviews/new',
    targetType: submission.targetType,
    targetSlug: submission.targetSlug,
    memberHandle: session.user.handle
  });

  return redirectTo(request, getReviewTargetHref(submission.targetType, submission.targetSlug), {
    reviewed: '1',
    review: review.slug
  });
}

import { NextRequest, NextResponse } from 'next/server';
import {
  feedbackIdFromFilename,
  moveFeedbackToAddressed,
  requireFeedbackAuth
} from '@/src/lib/feedback';
import { getClientIp, rateLimitHeaders, takeRateLimitHit } from '@/src/lib/rate-limit';

export const runtime = 'nodejs';

const APP_NAME = 'Vernissage';
const FEEDBACK_ADMIN_WINDOW_MS = 15 * 60 * 1000;
const FEEDBACK_ADMIN_LIMIT = 30;

export async function POST(request: NextRequest) {
  const rateLimit = takeRateLimitHit(`feedback-admin:${getClientIp(request)}`, FEEDBACK_ADMIN_LIMIT, FEEDBACK_ADMIN_WINDOW_MS);
  if (!rateLimit.ok) {
    return new Response('Too many feedback admin requests', {
      status: 429,
      headers: rateLimitHeaders(rateLimit)
    });
  }

  const authError = requireFeedbackAuth(request, APP_NAME);
  if (authError) {
    return authError;
  }

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const feedbackId = typeof payload.id === 'string' ? payload.id.trim() : '';
  const filename = typeof payload.filename === 'string' ? payload.filename.trim() : '';
  const addressedByCommit =
    typeof payload.addressed_by_commit === 'string' && payload.addressed_by_commit.trim()
      ? payload.addressed_by_commit.trim()
      : null;

  if (addressedByCommit && addressedByCommit.length > 200) {
    return new Response('Addressing commit must be < 200 characters', { status: 400 });
  }

  const resolvedFeedbackId = feedbackId || feedbackIdFromFilename(filename);
  if (!resolvedFeedbackId) {
    return new Response('Missing feedback id or filename', { status: 400 });
  }

  try {
    await moveFeedbackToAddressed(resolvedFeedbackId, addressedByCommit);
    return NextResponse.json({ status: 'success', message: 'Feedback marked as addressed' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Response('Feedback entry not found', { status: 404 });
    }
    throw error;
  }
}

import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

import { authOptions } from '@/src/lib/auth';
import {
  feedbackIdFromFilename,
  isFeedbackStatus,
  normalizePagePath,
  requireFeedbackAdminHandle,
  updateFeedbackEntry
} from '@/src/lib/feedback';
import { getClientIp, rateLimitHeaders, takeRateLimitHit } from '@/src/lib/rate-limit';
import { normalizeHandle } from '@/src/lib/review-submission';

export const runtime = 'nodejs';

const FEEDBACK_ADMIN_WINDOW_MS = 15 * 60 * 1000;
const FEEDBACK_ADMIN_LIMIT = 30;

function asTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

async function readPayload(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      payload: body,
      returnTo: normalizePagePath(asTrimmedString(body.return_to)) || '/feedback/updates',
      wantsRedirect: false
    };
  }

  const formData = await request.formData().catch(() => null);
  const body = Object.fromEntries(formData?.entries() ?? []) as Record<string, unknown>;
  return {
    payload: body,
    returnTo: normalizePagePath(asTrimmedString(body.return_to)) || '/feedback/updates',
    wantsRedirect: true
  };
}

export async function POST(request: NextRequest) {
  const rateLimit = takeRateLimitHit(`feedback-admin:${getClientIp(request)}`, FEEDBACK_ADMIN_LIMIT, FEEDBACK_ADMIN_WINDOW_MS);
  if (!rateLimit.ok) {
    return new Response('Too many feedback admin requests', {
      status: 429,
      headers: rateLimitHeaders(rateLimit)
    });
  }

  const session = await getServerSession(authOptions);
  const authError = requireFeedbackAdminHandle(session?.user?.handle);
  if (authError) {
    return authError;
  }

  const { payload, returnTo, wantsRedirect } = await readPayload(request);
  const feedbackId = asTrimmedString(payload.id);
  const filename = asTrimmedString(payload.filename);
  const status = asTrimmedString(payload.status);
  const addressedByCommit = asTrimmedString(payload.addressed_by_commit);
  const statusNote = asTrimmedString(payload.status_note);
  const assignedToHandle = normalizeHandle(asTrimmedString(payload.assigned_to_handle));

  if (!isFeedbackStatus(status)) {
    return new Response('Choose a valid feedback status', { status: 400 });
  }

  if (addressedByCommit.length > 200) {
    return new Response('Addressing commit must be < 200 characters', { status: 400 });
  }

  if (statusNote.length > 1000) {
    return new Response('Status note must be < 1000 characters', { status: 400 });
  }

  if (assignedToHandle.length > 80) {
    return new Response('Assigned handle must be < 80 characters', { status: 400 });
  }

  const resolvedFeedbackId = feedbackId || feedbackIdFromFilename(filename);
  if (!resolvedFeedbackId) {
    return new Response('Missing feedback id or filename', { status: 400 });
  }

  try {
    const updated = await updateFeedbackEntry(resolvedFeedbackId, {
      status,
      status_note: statusNote || null,
      assigned_to_handle: assignedToHandle || null,
      addressed_by_commit: addressedByCommit || null
    });

    if (wantsRedirect) {
      const redirectUrl = new URL(returnTo, request.url);
      redirectUrl.searchParams.set('updated', updated.id ?? resolvedFeedbackId);
      return NextResponse.redirect(redirectUrl, { status: 303 });
    }

    return NextResponse.json({
      status: 'success',
      message: 'Feedback updated',
      feedback: updated
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Response('Feedback entry not found', { status: 404 });
    }
    throw error;
  }
}

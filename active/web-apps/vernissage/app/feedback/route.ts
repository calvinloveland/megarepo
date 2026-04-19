import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import {
  createFeedbackEntry,
  normalizePagePath,
  readFeedbackEntries,
  requireFeedbackAdminHandle,
  resolveGitCommit
} from '@/src/lib/feedback';
import { getAppVersion } from '@/src/lib/app-version';
import { authOptions } from '@/src/lib/auth';
import { getClientIp, rateLimitHeaders, takeRateLimitHit } from '@/src/lib/rate-limit';

export const runtime = 'nodejs';

const APP_NAME = 'Vernissage';
const FEEDBACK_WINDOW_MS = 15 * 60 * 1000;
const FEEDBACK_POST_LIMIT = 8;
const FEEDBACK_ADMIN_LIMIT = 30;

function asTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function GET(request: NextRequest) {
  const rateLimit = takeRateLimitHit(`feedback-admin:${getClientIp(request)}`, FEEDBACK_ADMIN_LIMIT, FEEDBACK_WINDOW_MS);
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

  return NextResponse.json({
    open: await readFeedbackEntries(false),
    addressed: await readFeedbackEntries(true)
  });
}

export async function POST(request: NextRequest) {
  const rateLimit = takeRateLimitHit(`feedback:${getClientIp(request)}`, FEEDBACK_POST_LIMIT, FEEDBACK_WINDOW_MS);
  if (!rateLimit.ok) {
    return NextResponse.json(
      {
        status: 'error',
        message: 'Too many feedback submissions. Please wait a bit before sending another note.'
      },
      {
        status: 429,
        headers: rateLimitHeaders(rateLimit)
      }
    );
  }

  let data: unknown;
  try {
    data = await request.json();
  } catch {
    return new Response('Invalid feedback payload', { status: 400 });
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return new Response('Invalid feedback payload', { status: 400 });
  }

  const record = data as Record<string, unknown>;
  const feedbackText = asTrimmedString(record.feedback_text);
  const selectedElement = asTrimmedString(record.selected_element);
  const rawPagePath = asTrimmedString(record.page_path);
  const pageTitle = asTrimmedString(record.page_title);
  const design = asTrimmedString(record.design) || 'gilded-manuscript';
  const timestamp = asTrimmedString(record.timestamp) || new Date().toISOString();

  if (!feedbackText) {
    return new Response('Feedback text is required', { status: 400 });
  }
  if (feedbackText.length > 5000) {
    return new Response('Feedback text must be < 5000 characters', { status: 400 });
  }
  if (selectedElement.length > 500) {
    return new Response('Selected element must be < 500 characters', { status: 400 });
  }
  if (rawPagePath.length > 1000) {
    return new Response('Page path must be < 1000 characters', { status: 400 });
  }
  if (pageTitle.length > 500) {
    return new Response('Page title must be < 500 characters', { status: 400 });
  }
  if (design.length > 120) {
    return new Response('Design must be < 120 characters', { status: 400 });
  }
  if (timestamp.length > 120) {
    return new Response('Timestamp must be < 120 characters', { status: 400 });
  }

  const session = await getServerSession(authOptions);

  const payload = {
    feedback_text: feedbackText,
    selected_element: selectedElement || null,
    app: APP_NAME,
    page_path: normalizePagePath(rawPagePath || request.headers.get('referer') || '') || null,
    page_title: pageTitle || null,
    design,
    timestamp,
    server_timestamp: new Date().toISOString(),
    version: getAppVersion(),
    git_commit: await resolveGitCommit(),
    submitted_by_handle: session?.user?.handle?.trim() || null,
    submitted_by_name: session?.user?.name?.trim() || null
  };

  const created = await createFeedbackEntry(payload, null);
  return NextResponse.json({ status: 'success', message: 'Feedback saved', id: created.id });
}

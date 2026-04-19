import { NextResponse } from 'next/server';

import { members } from '@/src/lib/catalog';
import { recordAnalyticsEvent } from '@/src/lib/analytics';
import { normalizeCallbackUrl, parseRegistrationSubmission } from '@/src/lib/account-registration';
import { hashPassword } from '@/src/lib/passwords';
import { getPrisma, isDatabaseConfigured } from '@/src/lib/prisma';
import { getClientIp, rateLimitHeaders, takeRateLimitHit } from '@/src/lib/rate-limit';

const REGISTER_WINDOW_MS = 15 * 60 * 1000;
const REGISTER_POST_LIMIT = 5;

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
  const rateLimit = takeRateLimitHit(`register:${getClientIp(request)}`, REGISTER_POST_LIMIT, REGISTER_WINDOW_MS);
  if (!rateLimit.ok) {
    const response = redirectTo(request, '/join', { error: 'rate-limited' });
    for (const [name, value] of Object.entries(rateLimitHeaders(rateLimit))) {
      response.headers.set(name, value);
    }
    return response;
  }

  if (!isDatabaseConfigured()) {
    return redirectTo(request, '/join', { error: 'database-unavailable' });
  }

  const formData = await request.formData();
  const parsed = parseRegistrationSubmission(formData);
  if (!parsed.ok) {
    const callbackUrl = normalizeCallbackUrl(`${formData.get('callbackUrl') ?? ''}`);
    return redirectTo(request, '/join', { error: parsed.error, callbackUrl });
  }
  const { callbackUrl, name, handle, password } = parsed.value;

  if (members.some((member) => member.handle === handle)) {
    return redirectTo(request, '/join', { error: 'handle-unavailable', callbackUrl });
  }

  const prisma = getPrisma();
  const existingUser = await prisma.user.findFirst({
    where: {
      handle
    },
    select: {
      handle: true
    }
  });

  if (existingUser?.handle === handle) {
    return redirectTo(request, '/join', { error: 'handle-unavailable', callbackUrl });
  }

  await prisma.user.create({
    data: {
      name,
      handle,
      passwordHash: await hashPassword(password)
    }
  });

  await recordAnalyticsEvent({
    eventType: 'join_completed',
    pageType: 'join',
    path: '/join',
    memberHandle: handle
  });

  return redirectTo(request, '/signin', {
    registered: '1',
    identifier: handle,
    callbackUrl
  });
}

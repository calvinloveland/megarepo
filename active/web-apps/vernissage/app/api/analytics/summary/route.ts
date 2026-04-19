import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

import { readAnalyticsSummary } from '@/src/lib/analytics';
import { authOptions } from '@/src/lib/auth';
import { requireFeedbackAdminHandle } from '@/src/lib/feedback';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const authError = requireFeedbackAdminHandle(session?.user?.handle);
  if (authError) {
    return authError;
  }

  const daysValue = Number.parseInt(request.nextUrl.searchParams.get('days') ?? '7', 10);
  const summary = await readAnalyticsSummary(daysValue);
  return NextResponse.json(summary);
}

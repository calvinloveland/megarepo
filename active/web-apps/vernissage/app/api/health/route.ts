import { NextResponse } from 'next/server';
import { getAppVersion } from '@/src/lib/app-version';

export async function GET() {
  return NextResponse.json({
    ok: true,
    status: 'healthy',
    version: getAppVersion()
  });
}

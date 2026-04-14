import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    ok: true,
    status: 'healthy',
    version: process.env.APP_VERSION ?? 'development'
  });
}

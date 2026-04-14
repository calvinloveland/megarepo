import { NextResponse } from 'next/server';

import { getPrisma, isDatabaseConfigured } from '@/src/lib/prisma';

export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        status: 'database-unconfigured'
      },
      { status: 503 }
    );
  }

  await getPrisma().$queryRaw`SELECT 1`;

  return NextResponse.json({
    ok: true,
    status: 'ready'
  });
}

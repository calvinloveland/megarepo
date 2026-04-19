import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

import { getPrisma, isDatabaseConfigured } from '@/src/lib/prisma';
import { verifyPassword } from '@/src/lib/passwords';
import { clearRateLimitKey, getClientIp, peekRateLimit, takeRateLimitHit } from '@/src/lib/rate-limit';

const authSecret = process.env.NEXTAUTH_SECRET?.trim();
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_FAILURE_LIMIT = 10;

if (isDatabaseConfigured() && !authSecret) {
  throw new Error('NEXTAUTH_SECRET must be configured when DATABASE_URL is set.');
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: 'jwt'
  },
  pages: {
    signIn: '/signin'
  },
  secret: authSecret,
  providers: [
    CredentialsProvider({
      name: 'Vernissage account',
      credentials: {
        identifier: { label: 'Handle', type: 'text' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials, request) {
        if (!isDatabaseConfigured()) {
          return null;
        }

        const identifier = credentials?.identifier?.trim().toLowerCase() ?? '';
        const password = credentials?.password ?? '';
        const clientIp = request ? getClientIp(request as Pick<Request, 'headers'>) : 'unknown';
        const rateLimitKey = `auth:${clientIp}:${identifier || 'unknown'}`;
        const rateLimit = peekRateLimit(rateLimitKey, AUTH_FAILURE_LIMIT, AUTH_WINDOW_MS);
        if (!rateLimit.ok) {
          return null;
        }

        if (!identifier || !password) {
          takeRateLimitHit(rateLimitKey, AUTH_FAILURE_LIMIT, AUTH_WINDOW_MS);
          return null;
        }

        const user = await getPrisma().user.findFirst({
          where: {
            OR: [{ email: identifier }, { handle: identifier }]
          }
        });

        if (!user?.passwordHash) {
          takeRateLimitHit(rateLimitKey, AUTH_FAILURE_LIMIT, AUTH_WINDOW_MS);
          return null;
        }

        const isValid = await verifyPassword(password, user.passwordHash);
        if (!isValid) {
          takeRateLimitHit(rateLimitKey, AUTH_FAILURE_LIMIT, AUTH_WINDOW_MS);
          return null;
        }

        clearRateLimitKey(rateLimitKey);

        return {
          id: user.id,
          name: user.name?.trim() || user.handle,
          email: user.email ?? undefined,
          handle: user.handle
        };
      }
    })
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user && 'handle' in user && typeof user.handle === 'string') {
        token.handle = user.handle;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? '';
        session.user.handle = typeof token.handle === 'string' ? token.handle : undefined;
      }
      return session;
    }
  }
};

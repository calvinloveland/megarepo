import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

import { getPrisma, isDatabaseConfigured } from '@/src/lib/prisma';
import { verifyPassword } from '@/src/lib/passwords';

export const authOptions: NextAuthOptions = {
  session: {
    strategy: 'jwt'
  },
  pages: {
    signIn: '/signin'
  },
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    CredentialsProvider({
      name: 'Vernissage account',
      credentials: {
        identifier: { label: 'Handle', type: 'text' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!isDatabaseConfigured()) {
          return null;
        }

        const identifier = credentials?.identifier?.trim().toLowerCase() ?? '';
        const password = credentials?.password ?? '';
        if (!identifier || !password) {
          return null;
        }

        const user = await getPrisma().user.findFirst({
          where: {
            OR: [{ email: identifier }, { handle: identifier }]
          }
        });

        if (!user?.passwordHash) {
          return null;
        }

        const isValid = await verifyPassword(password, user.passwordHash);
        if (!isValid) {
          return null;
        }

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

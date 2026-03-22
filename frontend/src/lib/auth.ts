import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

/**
 * Admin login: username + password from env only.
 * No Google OAuth — set ADMIN_USERNAME, ADMIN_PASSWORD, NEXTAUTH_SECRET in .env.local
 */
export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const expectedUser = (process.env.ADMIN_USERNAME ?? "admin").trim();
        const expectedPass = process.env.ADMIN_PASSWORD;
        if (!expectedPass) {
          console.warn("[admin] ADMIN_PASSWORD is not set — login disabled.");
          return null;
        }
        const u = (credentials?.username ?? "").trim();
        const p = credentials?.password ?? "";
        if (u === expectedUser && p === expectedPass) {
          return {
            id: "admin",
            name: u,
            email: `${u}@local`,
          };
        }
        return null;
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 7,
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.name = user.name;
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.name = (token.name as string) ?? "User";
        session.user.email = (token.email as string) ?? "";
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  pages: {},
};

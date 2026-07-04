import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { db, schema } from "@/db";

// GitHub OAuth with NO scopes: grants user identity + public-repo reads on the
// user's 5k/hr rate-limit quota. We deliberately request nothing more for the
// public-repo MVP. JWT sessions — the access token lives in the encrypted
// session cookie, never at rest in our database.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt" },
  trustHost: true,
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account && profile) {
        token.accessToken = account.access_token;
        token.githubId = Number(profile.id);
        token.login = String(profile.login);
        await db()
          .insert(schema.users)
          .values({
            id: Number(profile.id),
            login: String(profile.login),
            name: profile.name ?? null,
          })
          .onConflictDoUpdate({
            target: schema.users.id,
            set: { login: String(profile.login), name: profile.name ?? null },
          });
      }
      return token;
    },
    async session({ session, token }) {
      session.githubId = token.githubId as number;
      session.login = token.login as string;
      session.accessToken = token.accessToken as string;
      return session;
    },
  },
});

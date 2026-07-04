import "next-auth";

declare module "next-auth" {
  interface Session {
    githubId: number;
    login: string;
    /**
     * Scope-less GitHub OAuth token (public reads + identity only).
     * Used server-side for GitHub API calls on the user's quota.
     */
    accessToken: string;
  }
}

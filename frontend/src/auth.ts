import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";

const BACKEND_URL = process.env.BACKEND_URL || "http://127.0.0.1:3014";

function decodeJwtPayload(token: string): Record<string, any> {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(base64, "base64").toString("utf8"));
  } catch {
    return {};
  }
}

// Temporary store for the Google internal token.
const googleTokenCache = new Map<string, string>();

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  providers: [
    // ── Google OAuth ───────────────────────────────────────────────────────
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),

    // ── Email / Password ───────────────────────────────────────────────────
    CredentialsProvider({
      id:   "credentials",
      name: "Email & Password",
      credentials: {
        email:    { label: "Email",    type: "email"    },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        let res: Response;
        try {
          res = await fetch(`${BACKEND_URL}/auth/login`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({
              email:    credentials.email,
              password: credentials.password,
            }),
          });
        } catch {
          throw new Error("SERVICE_UNAVAILABLE");
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const code = body?.detail?.code ?? "INVALID_CREDENTIALS";
          throw new Error(code);
        }

        const data = await res.json();

        return {
          id:             data.user_id,
          email:          data.email,
          name:           data.name,
          role:           data.role,
          internal_token: data.token,
        };
      },
    }),
  ],

  callbacks: {
    async signIn({ account }) {
      if (account?.provider === "google") {
        const idToken = account?.id_token;
        if (!idToken) return false;
        try {
          const res = await fetch(`${BACKEND_URL}/auth/google/token`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ id_token: idToken }),
          });
          if (!res.ok) return false;
          const { token } = await res.json();
          googleTokenCache.set(account.providerAccountId, token);
        } catch {
          return false;
        }
      }
      return true;
    },

    async jwt({ token, account, user }) {
      // Google sign-in (including linked accounts)
      if (account?.provider === "google") {
        const internalToken = googleTokenCache.get(account.providerAccountId);
        if (internalToken) {
          token.accessToken   = internalToken;
          const p             = decodeJwtPayload(internalToken);
          token.role          = p.role;
          token.user_id       = p.user_id;
          token.auth_provider = p.auth_provider || "google";  // Can be "google" or "linked"
          googleTokenCache.delete(account.providerAccountId);
        }
      }

      // Credentials sign-in (including linked accounts)
      if (account?.provider === "credentials" && (user as any)?.internal_token) {
        token.accessToken   = (user as any).internal_token as string;
        token.role          = (user as any).role;
        token.user_id       = (user as any).id;
        token.auth_provider = (user as any).auth_provider || "email";  // Can be "email" or "linked"
      }

      return token;
    },

    async session({ session, token }) {
      (session as any).accessToken   = token.accessToken as string;
      (session as any).role          = token.role as string;
      (session as any).user_id       = token.user_id as string;
      (session as any).auth_provider = token.auth_provider as string;
      return session;
    },
  },

  pages: {
    signIn: "/login",
    error:  "/auth/error",
  },

  session: { strategy: "jwt" },
});

import { LoginData, storeSession } from "@/server/authServer/authServer";
import axios from "axios";
import CredentialsProvider from "next-auth/providers/credentials";

export const options = {
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "Custom Sign In",
      credentials: {},
      async authorize(credentials, req) {
        const platform = req.headers["sec-ch-ua-platform"] || "";
        const isMobile = req.headers["sec-ch-ua-mobile"] === '"?1"';
        const browser = req.headers["sec-ch-ua"];
        const ip =
          req.headers["x-forwarded-for"] || req.connection.remoteAddress;

        try {
          if (!credentials?.email || !credentials?.password) {
            throw new Error("Please provide both email and password.");
          }

          const { email, password } = credentials;
          const response = await LoginData(email, password);

          if (!response?.status) {
            throw new Error(response?.message || "Invalid login attempt.");
          }

          // Optional: Fetch and store session details
          const newip = await axios
            .get("http://ip-api.com/json/")
            .catch((err) => {
              console.error("IP API error:", err.message);
              return { status: 500, data: {} }; // Fallback if API fails
            });

          if (newip.status === 200) {
            await storeSession({
              ...newip.data,
              ...response.data,
              platform,
              browser,
              device: isMobile ? "Mobile" : "Desktop",
              ip,
            });

            // if (!data.status) {
            //   throw new Error(data?.message);
            // }
          }

          return { ...response?.data };
        } catch (error) {
          console.error("Authorize error:", error.message);
          throw new Error(error.message); // Propagate error to sign-in page
        }
      },
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
    jwt: { encryption: true },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user._id;
        token.name = user.name;
        token.email = user.email;
        token.role = user.role;
        // token.siteId = user.siteId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session?.user) {
        session.user._id = token.id;
        session.user.role = token.role;
        // session.user.siteId = token.siteId;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth", // Sign-in page
  },
};

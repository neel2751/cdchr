import "./globals.css";
import { Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "HR Management",
  description: "Hr Management System",
  // Without a manifest declaring display:standalone, iOS cannot install this
  // to the Home Screen — and an installed PWA is the ONLY way Safari delivers
  // web push. The clock-out reminder was therefore impossible on every iPhone,
  // no matter what the notification banner told people to do.
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "HR",
    statusBarStyle: "default",
  },
};

export const viewport = {
  themeColor: "#4f46e5",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>
        {children}
        <Toaster richColors />
      </body>
    </html>
  );
}

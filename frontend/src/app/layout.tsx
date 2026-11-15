import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });

const APP_NAME = "Smart MoM";
const APP_DESCRIPTION = "AI-powered meeting transcription, summaries, and insights";

export const metadata: Metadata = {
  applicationName: APP_NAME,
  title:       "Smart MoM — AI Meeting Intelligence",
  description: APP_DESCRIPTION,
  manifest:    "/manifest.webmanifest",
  appleWebApp: {
    capable:         true,
    statusBarStyle:  "default",
    title:           APP_NAME,
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/smart-mom.png", type: "image/png", sizes: "any" }],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" />
      </head>
      <body className={`${inter.variable} ${manrope.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

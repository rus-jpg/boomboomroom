import type { Metadata } from "next";
import { Outfit, Syne } from "next/font/google";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });
const syne = Syne({ subsets: ["latin"], variable: "--font-syne" });

const siteUrl = new URL("https://boom-boom-room.vercel.app");
const title = "Boom Boom Room";
const description =
  "Multiplayer AI generative music party. One room. Sixty seconds on the booth.";

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title,
  description,
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: "Boom Boom Room",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Boom Boom Room — live AI music party",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${outfit.variable} ${syne.variable}`}>
        <div className="grain" aria-hidden />
        {children}
      </body>
    </html>
  );
}

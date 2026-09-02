import type { Metadata } from "next";
import { Outfit, Syne } from "next/font/google";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });
const syne = Syne({ subsets: ["latin"], variable: "--font-syne" });

export const metadata: Metadata = {
  metadataBase: new URL("https://boom-boom-room.vercel.app"),
  title: "Boom Boom Room",
  description: "A live AI music party — cast in, dance, take the booth.",
  openGraph: {
    title: "Boom Boom Room",
    description: "A live AI music party — cast in, dance, take the booth.",
    siteName: "Boom Boom Room",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Boom Boom Room",
    description: "A live AI music party — cast in, dance, take the booth.",
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

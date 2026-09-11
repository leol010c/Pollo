import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

/**
 * The display face, used for the position's name and the deck's title.
 *
 * A serif here was tried once before and pulled back out for giving the name a
 * formality the rest of the interface didn't have — but that was a serif used
 * in exactly one place. Applied to both the reveal and the deck it stops being
 * an exception and becomes the voice the app names things in, which is the
 * difference between a flourish and a typeface.
 *
 * Garamond rather than a high-contrast editorial face: those read expensive and
 * a little cold, and this moment wants warm.
 */
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dice Throw",
  description:
    "A 3D physics dice simulator. Click a die to throw it and read whatever lands face up.",
};

export const viewport: Viewport = {
  // Matches --bg, which in turn matches the active backdrop's clear colour.
  themeColor: "#150610",
  width: "device-width",
  initialScale: 1,
  // Zoom stays enabled — disabling it is an accessibility failure.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // `dark` is fixed rather than toggled: this is a dark-only product, and the
    // class keeps shadcn's `dark:` variants resolving to the right tokens.
    <html
      lang="en"
      className={`dark h-full antialiased ${inter.variable} ${cormorant.variable}`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}

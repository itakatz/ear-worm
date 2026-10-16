import type { Metadata } from 'next';
import './globals.css';
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Earworm — Phrase Training Over Harmony',
  description: 'Train your musical ear with melodic phrases over a sustained chord.',
  openGraph: { title: 'Earworm', description: 'Phrase training over harmony', images: [`${siteUrl}/og.png`] },
  twitter: { card: 'summary_large_image', title: 'Earworm', description: 'Phrase training over harmony', images: [`${siteUrl}/og.png`] },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }

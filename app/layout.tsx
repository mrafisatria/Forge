import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Forge — Gym Tracker',
  description: 'Susun routine, catat set, beban, dan repetisi workout kamu.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Forge', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml', sizes: 'any' }],
    apple: [{ url: '/apple-icon.png', type: 'image/png', sizes: '180x180' }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Forge — Gym Tracker',
  description: 'Susun routine, catat set, beban, dan repetisi workout kamu.',
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

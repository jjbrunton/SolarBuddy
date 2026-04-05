import type { Metadata, Viewport } from 'next';
import { Fraunces, Geist_Mono, Instrument_Sans } from 'next/font/google';
import { AppShell } from '@/components/layout/AppShell';
import './globals.css';

/*
 * Agile Almanac typography
 * - Display / numerics: Fraunces (variable serif, opsz + SOFT axes)
 * - Body / UI: Instrument Sans (warm grotesk)
 * - Mono / diagnostics: Geist Mono
 */
const sans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-sb-sans',
  display: 'swap',
});

const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-sb-display',
  axes: ['SOFT', 'WONK', 'opsz'],
  display: 'swap',
});

const mono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-sb-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'SolarBuddy', template: '%s | SolarBuddy' },
  description: 'Octopus Agile + Solar Assistant charging optimizer',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SolarBuddy',
  },
  icons: {
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#ffb547',
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('sb-theme');document.documentElement.className=t||'dark'}catch(e){document.documentElement.className='dark'}})()`,
          }}
        />
      </head>
      <body
        className={`${sans.variable} ${display.variable} ${mono.variable} sb-grain min-h-screen bg-sb-bg font-[family-name:var(--font-sb-sans)] text-sb-text antialiased`}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

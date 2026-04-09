import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import { AppShell } from '@/components/layout/AppShell';
import './globals.css';

/*
 * Terminal Blueprint typography
 * - Mono: JetBrains Mono for everything — body, display, code
 * Pure monospace design. No serif, no sans-serif.
 */
const mono = JetBrains_Mono({
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
  themeColor: '#ff6600',
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
        className={`${mono.variable} sb-grain min-h-screen bg-sb-bg font-[family-name:var(--font-sb-mono)] text-sb-text antialiased`}
      >
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

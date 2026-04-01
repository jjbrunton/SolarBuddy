import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Manrope } from 'next/font/google';
import { AppShell } from '@/components/layout/AppShell';
import './globals.css';

const sans = Manrope({
  subsets: ['latin'],
  variable: '--font-sb-sans',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-sb-mono',
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
  themeColor: '#44b0c9',
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
      <body className={`${sans.variable} ${mono.variable} min-h-screen bg-sb-bg font-[family-name:var(--font-sb-sans)] text-sb-text antialiased`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

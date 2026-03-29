import type { Metadata, Viewport } from 'next';
import { AppShell } from '@/components/layout/AppShell';
import './globals.css';

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
  themeColor: '#5d9cec',
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
      <body className="min-h-screen bg-sb-bg text-sb-text">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

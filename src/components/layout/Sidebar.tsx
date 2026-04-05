'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Zap,
  Calendar,
  Wallet,
  Activity,
  FlaskConical,
  Settings,
  Server,
  Sun,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface NavItem {
  icon: LucideIcon;
  label: string;
  href: string;
}

const NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/' },
  { icon: Calendar, label: 'Schedule', href: '/schedule' },
  { icon: Zap, label: 'Energy Rates', href: '/rates' },
  { icon: Wallet, label: 'Savings', href: '/savings' },
  { icon: Activity, label: 'Usage Profile', href: '/usage' },
  { icon: FlaskConical, label: 'Simulation', href: '/simulate' },
  { icon: Settings, label: 'Settings', href: '/settings' },
  { icon: Server, label: 'System', href: '/system' },
];

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

export function Sidebar({
  mobileOpen,
  onClose,
}: {
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 bg-sb-bg/70 backdrop-blur-sm lg:hidden" onClick={onClose} />
      ) : null}

      <aside
        className={`sb-shell-panel fixed top-0 left-0 z-50 flex h-full w-[240px] flex-col border-r border-sb-rule bg-sb-sidebar px-5 py-6 transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand */}
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3" onClick={onClose}>
            <div className="relative flex h-10 w-10 items-center justify-center rounded-full border border-sb-ember/40 bg-sb-ember/10 text-sb-ember">
              <Sun size={18} />
              <span className="absolute inset-0 rounded-full border border-sb-ember/20 blur-[1px]" />
            </div>
            <p className="sb-display text-lg leading-tight text-sb-text">SolarBuddy</p>
          </Link>
          <button onClick={onClose} className="rounded-lg p-2 text-sb-text-muted hover:text-sb-ember lg:hidden">
            <X size={18} />
          </button>
        </div>

        <div className="sb-rule mt-6" />

        <nav className="mt-6 flex-1 space-y-0.5 overflow-y-auto pr-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`group relative flex items-center gap-3 rounded-[0.5rem] px-3 py-2.5 text-[0.85rem] transition-colors ${
                  active
                    ? 'bg-sb-ember/10 text-sb-ember'
                    : 'text-sb-text-muted hover:bg-sb-card/60 hover:text-sb-text'
                }`}
              >
                {active ? (
                  <span className="absolute inset-y-1 left-0 w-[2px] rounded-full bg-sb-ember" />
                ) : null}
                <item.icon size={16} className={active ? 'text-sb-ember' : ''} />
                <span className="tracking-[0.01em]">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sb-rule mt-4" />

        <div className="mt-4 flex flex-col gap-1">
          <p className="sb-eyebrow">Version</p>
          <p className="font-[family-name:var(--font-sb-mono)] text-[0.72rem] text-sb-text">v1.0.0</p>
        </div>
      </aside>
    </>
  );
}

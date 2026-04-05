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
        className={`sb-shell-panel fixed top-0 left-0 z-50 flex h-full w-[260px] flex-col border-r border-sb-border bg-sb-sidebar px-4 py-4 transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-14 items-center justify-between rounded-2xl border border-sb-border bg-sb-card px-4">
          <Link href="/" className="flex items-center gap-3" onClick={onClose}>
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-sb-warning/14 text-sb-warning">
              <Sun size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-[-0.02em] text-sb-text">SolarBuddy</p>
              <p className="text-[0.7rem] uppercase tracking-[0.16em] text-sb-text-subtle">Energy control</p>
            </div>
          </Link>
          <button onClick={onClose} className="rounded-xl p-2 text-sb-text-muted hover:text-sb-text lg:hidden">
            <X size={18} />
          </button>
        </div>

        <nav className="mt-5 flex-1 space-y-2 overflow-y-auto pr-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? 'bg-sb-active text-sb-text'
                    : 'text-sb-text-muted hover:bg-sb-active/70 hover:text-sb-text'
                }`}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-5 rounded-2xl border border-sb-border bg-sb-card px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sb-text-subtle">
            Version
          </p>
          <p className="mt-1 text-sm text-sb-text">SolarBuddy v1.0.0</p>
        </div>
      </aside>
    </>
  );
}

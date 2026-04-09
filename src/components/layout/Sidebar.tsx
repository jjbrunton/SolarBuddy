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
        <div className="fixed inset-0 z-40 bg-black/80 lg:hidden" onClick={onClose} />
      ) : null}

      <aside
        className={`sb-shell-panel fixed top-0 left-0 z-50 flex h-full w-[240px] flex-col border-r border-sb-border bg-sb-sidebar px-4 py-5 transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand */}
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" onClick={onClose}>
            <div className="flex h-8 w-8 items-center justify-center border border-sb-ember/50 bg-sb-ember/10 text-sb-ember">
              <span className="text-sm font-bold">SB</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[0.8rem] font-bold uppercase tracking-[0.12em] text-sb-ember">
                SolarBuddy
              </span>
              <span className="text-[0.58rem] uppercase tracking-[0.2em] text-sb-text-subtle">
                Control System
              </span>
            </div>
          </Link>
          <button onClick={onClose} className="p-2 text-sb-text-muted hover:text-sb-ember lg:hidden">
            <X size={16} />
          </button>
        </div>

        <div className="sb-rule mt-4" />

        <nav className="mt-4 flex-1 space-y-px overflow-y-auto pr-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`group relative flex items-center gap-2.5 px-3 py-2 text-[0.78rem] uppercase tracking-[0.06em] transition-colors ${
                  active
                    ? 'bg-sb-ember/10 text-sb-ember'
                    : 'text-sb-text-muted hover:bg-sb-card/60 hover:text-sb-text'
                }`}
              >
                {active ? (
                  <span className="absolute inset-y-0 left-0 w-[2px] bg-sb-ember" />
                ) : null}
                <item.icon size={14} strokeWidth={1.5} className={active ? 'text-sb-ember' : ''} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sb-rule mt-4" />

        <div className="mt-3 flex flex-col gap-0.5">
          <span className="text-[0.6rem] uppercase tracking-[0.2em] text-sb-text-subtle">
            Version
          </span>
          <span className="text-[0.7rem] text-sb-text-muted">v1.0.0</span>
        </div>
      </aside>
    </>
  );
}

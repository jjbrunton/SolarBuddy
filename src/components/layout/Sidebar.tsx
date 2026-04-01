'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard,
  Zap,
  Calendar,
  Battery,
  Sun,
  Activity,
  BarChart3,
  Settings,
  Server,
  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface NavChild {
  label: string;
  href: string;
}

interface NavItem {
  icon: LucideIcon;
  label: string;
  href: string;
  children?: NavChild[];
}

const NAV_ITEMS: NavItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard', href: '/' },
  { icon: Zap, label: 'Energy Rates', href: '/rates' },
  { icon: Calendar, label: 'Schedule', href: '/schedule' },
  { icon: Battery, label: 'Inverter', href: '/inverter' },
  { icon: Sun, label: 'Solar', href: '/solar' },
  { icon: Activity, label: 'Activity', href: '/activity' },
  {
    icon: BarChart3,
    label: 'Analytics',
    href: '/analytics',
    children: [
      { label: 'Cost Savings', href: '/analytics' },
      { label: 'Energy Flow', href: '/analytics/energy' },
      { label: 'Battery Health', href: '/analytics/battery' },
      { label: 'Carbon', href: '/analytics/carbon' },
      { label: 'Rate Trends', href: '/analytics/rates' },
    ],
  },
  {
    icon: Settings,
    label: 'Settings',
    href: '/settings',
    children: [
      { label: 'General', href: '/settings' },
      { label: 'MQTT', href: '/settings/mqtt' },
      { label: 'Octopus Energy', href: '/settings/octopus' },
      { label: 'Charging', href: '/settings/charging' },
    ],
  },
  {
    icon: Server,
    label: 'System',
    href: '/system',
    children: [
      { label: 'Status', href: '/system' },
      { label: 'Tasks', href: '/system/tasks' },
      { label: 'Logs', href: '/system/logs' },
    ],
  },
];

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(href + '/');
}

function NavItemComponent({
  item,
  pathname,
  closeMobile,
}: {
  item: NavItem;
  pathname: string;
  closeMobile: () => void;
}) {
  const active = isActive(pathname, item.href);
  const [expanded, setExpanded] = useState(active && !!item.children);

  if (item.children) {
    return (
      <div className="space-y-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-colors ${
            active
              ? 'bg-sb-active text-sb-text'
              : 'text-sb-text-muted hover:bg-sb-active/70 hover:text-sb-text'
          }`}
        >
          <item.icon size={18} />
          <span className="flex-1 text-left">{item.label}</span>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {expanded ? (
          <div className="ml-4 space-y-1 border-l border-sb-border pl-4">
            {item.children.map((child) => (
              <Link
                key={child.href}
                href={child.href}
                onClick={closeMobile}
                className={`block rounded-xl px-3 py-2 text-sm transition-colors ${
                  pathname === child.href
                    ? 'bg-sb-active text-sb-text'
                    : 'text-sb-text-muted hover:bg-sb-active/60 hover:text-sb-text'
                }`}
              >
                {child.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={closeMobile}
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
          {NAV_ITEMS.map((item) => (
            <NavItemComponent
              key={item.href}
              item={item}
              pathname={pathname}
              closeMobile={onClose}
            />
          ))}
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

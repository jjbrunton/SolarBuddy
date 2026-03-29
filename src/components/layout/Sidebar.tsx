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
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
            active
              ? 'bg-sb-active text-sb-text'
              : 'text-sb-text-muted hover:bg-sb-active/50 hover:text-sb-text'
          }`}
        >
          <item.icon size={18} />
          <span className="flex-1 text-left">{item.label}</span>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {expanded && (
          <div className="ml-5 mt-1 space-y-0.5 border-l border-sb-border pl-3">
            {item.children.map((child) => (
              <Link
                key={child.href}
                href={child.href}
                onClick={closeMobile}
                className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                  pathname === child.href
                    ? 'bg-sb-active text-sb-text'
                    : 'text-sb-text-muted hover:bg-sb-active/50 hover:text-sb-text'
                }`}
              >
                {child.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={closeMobile}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
        active
          ? 'bg-sb-active text-sb-text'
          : 'text-sb-text-muted hover:bg-sb-active/50 hover:text-sb-text'
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
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-0 left-0 z-50 flex h-full w-[220px] flex-col bg-sb-sidebar transition-transform duration-200 lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex h-14 items-center justify-between border-b border-sb-border px-4">
          <Link href="/" className="flex items-center gap-2" onClick={onClose}>
            <Sun size={22} className="text-sb-warning" />
            <span className="text-base font-bold text-sb-text">SolarBuddy</span>
          </Link>
          <button onClick={onClose} className="text-sb-text-muted hover:text-sb-text lg:hidden">
            <X size={18} />
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV_ITEMS.map((item) => (
            <NavItemComponent
              key={item.href}
              item={item}
              pathname={pathname}
              closeMobile={onClose}
            />
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-sb-border px-4 py-3">
          <p className="text-xs text-sb-text-muted">SolarBuddy v1.0.0</p>
        </div>
      </aside>
    </>
  );
}

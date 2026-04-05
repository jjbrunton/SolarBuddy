'use client';

import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggle: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const stored = localStorage.getItem('sb-theme') as Theme | null;
    if (stored === 'light' || stored === 'dark') {
      setTheme(stored);
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.className = next;
      localStorage.setItem('sb-theme', next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);

  return (
    <ThemeContext value={value}>
      {children}
    </ThemeContext>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

/**
 * Returns resolved hex values from CSS variables for Recharts.
 *
 * The palette is organised around the Agile Almanac ember/frost duality:
 * - ember = solar, charge, stored energy
 * - frost = grid, import, cold side
 * - ink / muted / subtle = editorial text scale
 * - rule / border = hairline dividers
 *
 * Legacy keys (accent, success, warning, danger, solar, grid, load) are
 * preserved so existing chart code keeps working.
 */
export function useChartColors() {
  const { theme } = useTheme();

  return useMemo(() => {
    if (typeof window === 'undefined') {
      // SSR fallback — dark-theme almanac defaults
      return {
        text: '#efe7d4',
        ink: '#efe7d4',
        muted: '#b6a98c',
        subtle: '#7f745d',
        accent: '#ffb547',
        ember: '#ffb547',
        emberDeep: '#e07a2a',
        frost: '#7fb3ff',
        frostDeep: '#3e6bd6',
        success: '#6bb87a',
        warning: '#e8a046',
        danger: '#d95545',
        info: '#7fb3ff',
        border: 'rgba(239, 231, 212, 0.1)',
        rule: 'rgba(239, 231, 212, 0.14)',
        card: 'rgba(24, 18, 12, 0.78)',
        cardBorder: 'rgba(239, 231, 212, 0.22)',
        solar: '#ffb547',
        grid: '#7fb3ff',
        load: '#d8a8ff',
      };
    }
    const style = getComputedStyle(document.documentElement);
    const get = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;
    return {
      text: get('--color-sb-text', '#efe7d4'),
      ink: get('--color-sb-ink', '#efe7d4'),
      muted: get('--color-sb-text-muted', '#b6a98c'),
      subtle: get('--color-sb-text-subtle', '#7f745d'),
      accent: get('--color-sb-accent', '#ffb547'),
      ember: get('--color-sb-ember', '#ffb547'),
      emberDeep: get('--color-sb-ember-deep', '#e07a2a'),
      frost: get('--color-sb-frost', '#7fb3ff'),
      frostDeep: get('--color-sb-frost-deep', '#3e6bd6'),
      success: get('--color-sb-success', '#6bb87a'),
      warning: get('--color-sb-warning', '#e8a046'),
      danger: get('--color-sb-danger', '#d95545'),
      info: get('--color-sb-info', '#7fb3ff'),
      border: get('--color-sb-border', 'rgba(239,231,212,0.1)'),
      rule: get('--color-sb-rule', 'rgba(239,231,212,0.14)'),
      card: get('--color-sb-card', 'rgba(24,18,12,0.78)'),
      cardBorder: get('--color-sb-border-strong', 'rgba(239,231,212,0.22)'),
      solar: get('--color-sb-solar', '#ffb547'),
      grid: get('--color-sb-grid', '#7fb3ff'),
      load: get('--color-sb-load', '#d8a8ff'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}

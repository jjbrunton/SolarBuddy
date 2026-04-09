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
 * Terminal Blueprint palette: orange/black primary with cyan frost.
 */
export function useChartColors() {
  const { theme } = useTheme();

  return useMemo(() => {
    if (typeof window === 'undefined') {
      // SSR fallback — dark terminal defaults
      return {
        text: '#d4d4d4',
        ink: '#d4d4d4',
        muted: '#808080',
        subtle: '#505050',
        accent: '#ff6600',
        ember: '#ff6600',
        emberDeep: '#cc5200',
        frost: '#00aaff',
        frostDeep: '#0077cc',
        success: '#00cc66',
        warning: '#ffaa00',
        danger: '#ff3333',
        info: '#00aaff',
        border: 'rgba(255, 102, 0, 0.12)',
        rule: 'rgba(255, 102, 0, 0.10)',
        card: 'rgba(17, 17, 17, 0.85)',
        cardBorder: 'rgba(255, 102, 0, 0.25)',
        solar: '#ff6600',
        grid: '#00aaff',
        load: '#aa66ff',
      };
    }
    const style = getComputedStyle(document.documentElement);
    const get = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;
    return {
      text: get('--color-sb-text', '#d4d4d4'),
      ink: get('--color-sb-ink', '#d4d4d4'),
      muted: get('--color-sb-text-muted', '#808080'),
      subtle: get('--color-sb-text-subtle', '#505050'),
      accent: get('--color-sb-accent', '#ff6600'),
      ember: get('--color-sb-ember', '#ff6600'),
      emberDeep: get('--color-sb-ember-deep', '#cc5200'),
      frost: get('--color-sb-frost', '#00aaff'),
      frostDeep: get('--color-sb-frost-deep', '#0077cc'),
      success: get('--color-sb-success', '#00cc66'),
      warning: get('--color-sb-warning', '#ffaa00'),
      danger: get('--color-sb-danger', '#ff3333'),
      info: get('--color-sb-info', '#00aaff'),
      border: get('--color-sb-border', 'rgba(255,102,0,0.12)'),
      rule: get('--color-sb-rule', 'rgba(255,102,0,0.10)'),
      card: get('--color-sb-card', 'rgba(17,17,17,0.85)'),
      cardBorder: get('--color-sb-border-strong', 'rgba(255,102,0,0.25)'),
      solar: get('--color-sb-solar', '#ff6600'),
      grid: get('--color-sb-grid', '#00aaff'),
      load: get('--color-sb-load', '#aa66ff'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}

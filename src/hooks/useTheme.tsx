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

/** Returns resolved hex values from CSS variables for use in Recharts */
export function useChartColors() {
  const { theme } = useTheme();

  return useMemo(() => {
    if (typeof window === 'undefined') {
      // SSR fallback — return dark theme defaults
      return {
        text: '#e1e2e3',
        muted: '#999999',
        accent: '#5d9cec',
        success: '#27c24c',
        warning: '#ff902b',
        danger: '#f05050',
        border: '#333333',
        card: '#2a2a2a',
        cardBorder: '#333333',
      };
    }
    const style = getComputedStyle(document.documentElement);
    const get = (name: string) => style.getPropertyValue(name).trim();
    return {
      text: get('--color-sb-text') || '#e1e2e3',
      muted: get('--color-sb-text-muted') || '#999999',
      accent: get('--color-sb-accent') || '#5d9cec',
      success: get('--color-sb-success') || '#27c24c',
      warning: get('--color-sb-warning') || '#ff902b',
      danger: get('--color-sb-danger') || '#f05050',
      border: get('--color-sb-border') || '#333333',
      card: get('--color-sb-card') || '#2a2a2a',
      cardBorder: get('--color-sb-border') || '#333333',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}

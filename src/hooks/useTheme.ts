import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'blue' | 'pink' | 'yellow';

const STORAGE_KEY = 'scout-theme';
const THEMES: Theme[] = ['dark', 'blue', 'pink', 'yellow'];

// Uses data-theme attribute on :root so the CSS selector :root[data-theme="blue"]
// has specificity (0,2,0) — definitively higher than :root's (0,1,0).
// Dark is the default so we just remove the attribute entirely for dark mode.
function applyTheme(theme: Theme) {
  if (theme === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    return THEMES.includes(saved as Theme) ? (saved as Theme) : 'dark';
  });

  // Apply immediately on mount (synchronously before paint via layout effect)
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem(STORAGE_KEY, t);
    setThemeState(t);
    applyTheme(t); // apply immediately without waiting for re-render
  }, []);

  return { theme, setTheme };
}

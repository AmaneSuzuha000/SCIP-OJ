import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';
const KEY = 'scip-oj.theme';

/** Guarded because this module is also imported outside a DOM (tests, prerender). */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // private mode / blocked storage
  }
}

function apply(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme =
    theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
}

interface ThemeStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  cycle: () => void;
}

const stored = storage()?.getItem(KEY);
/** Explicit choice wins; the product default is light, never the OS guess. */
const initial: Theme = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'light';

export const useTheme = create<ThemeStore>((set, get) => ({
  theme: initial,
  setTheme: (theme) => {
    storage()?.setItem(KEY, theme);
    apply(theme);
    set({ theme });
  },
  cycle: () => {
    const order: Theme[] = ['light', 'dark', 'system'];
    const current = get().theme;
    const next = order[(order.indexOf(current) + 1) % order.length] ?? 'system';
    get().setTheme(next);
  },
}));

export function initTheme(): void {
  apply(useTheme.getState().theme);
}

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

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'dark' || theme === 'light') return theme;
  const prefersDark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

function apply(theme: Theme): 'light' | 'dark' {
  const resolved = resolveTheme(theme);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolved;
  }
  return resolved;
}

interface ThemeStore {
  theme: Theme;
  resolved: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  cycle: () => void;
}

const stored = storage()?.getItem(KEY);
/** Explicit choice wins; the product default is light, never the OS guess. */
const initial: Theme = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'light';

export const useTheme = create<ThemeStore>((set, get) => ({
  theme: initial,
  resolved: resolveTheme(initial),
  setTheme: (theme) => {
    storage()?.setItem(KEY, theme);
    const resolved = apply(theme);
    set({ theme, resolved });
  },
  cycle: () => {
    const order: Theme[] = ['light', 'dark', 'system'];
    const current = get().theme;
    const next = order[(order.indexOf(current) + 1) % order.length] ?? 'system';
    get().setTheme(next);
  },
}));

let systemListenerAttached = false;

export function initTheme(): void {
  const current = useTheme.getState().theme;
  const resolved = apply(current);
  useTheme.setState({ resolved });

  if (!systemListenerAttached && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    systemListenerAttached = true;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (useTheme.getState().theme === 'system') {
        const nextResolved = apply('system');
        useTheme.setState({ resolved: nextResolved });
      }
    };
    mq.addEventListener?.('change', onChange);
  }
}

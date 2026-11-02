/** Runtime configuration, injected by the deploy step as window.SCIP_OJ_CONFIG. */
export interface RuntimeConfig {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

declare global {
  interface Window {
    SCIP_OJ_CONFIG?: Partial<RuntimeConfig>;
  }
}

function readConfig(): RuntimeConfig {
  const injected = typeof window !== 'undefined' ? window.SCIP_OJ_CONFIG : undefined;
  const url = injected?.SUPABASE_URL ?? import.meta.env.VITE_SUPABASE_URL;
  const key = injected?.SUPABASE_ANON_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      '缺少 Supabase 运行配置：请在部署时提供 config.js (window.SCIP_OJ_CONFIG) 或设置 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY。',
    );
  }
  return { SUPABASE_URL: url, SUPABASE_ANON_KEY: key };
}

let cached: RuntimeConfig | null = null;

/** Lazily resolved so the app can boot and show a clear error instead of a blank page. */
export function getConfig(): RuntimeConfig {
  cached ??= readConfig();
  return cached;
}

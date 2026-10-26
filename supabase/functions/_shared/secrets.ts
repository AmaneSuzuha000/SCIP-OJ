// supabase/functions/_shared/secrets.ts
// 密钥解析：优先 Deno.env，其次回退至 public.platform_secrets (RLS 仅 service_role 可查)

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";

export async function getPlatformSecret(
  supabase: SupabaseClient,
  name: string,
): Promise<string | null> {
  // 1. 优先从 Deno.env 获取
  const fromEnv = Deno.env.get(name);
  if (fromEnv) return fromEnv;

  // 2. 回退查询 platform_secrets 表
  try {
    const { data, error } = await supabase
      .from("platform_secrets")
      .select("value")
      .eq("key", name)
      .maybeSingle();

    if (error) {
      console.warn(`[Secrets] 读取 platform_secrets [${name}] 失败:`, error.message);
      return null;
    }
    return data?.value ?? null;
  } catch (err: any) {
    console.warn(`[Secrets] 读取 platform_secrets [${name}] 异常:`, err?.message || err);
    return null;
  }
}

/** 创建默认的 Supabase 服务端 Service Client */
export function createServiceClient(): {
  supabase: SupabaseClient;
  supabaseUrl: string;
  serviceRoleKey: string;
} {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("服务端环境变量缺失：SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 未设置");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  return { supabase, supabaseUrl, serviceRoleKey };
}

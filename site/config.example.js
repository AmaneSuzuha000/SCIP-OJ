/**
 * SCIP-OJ 平台配置
 * 复制为 config.js 并填入真实值。config.js 已在 .gitignore 中。
 * 构建部署时可由 CI 注入。
 */
window.SCIP_OJ_CONFIG = {
  // Supabase 配置（anon key 可以放前端，service_role 绝对不行）
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  // 设为 true 可在无后端时仍然显示平台 UI（开发调试用）
  MOCK_MODE: false,
};

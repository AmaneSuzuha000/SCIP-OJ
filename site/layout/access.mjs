/* The original body stays inert until server-side admission succeeds. */
export function protectPage(html) {
    return html.replace(/<body([^>]*)>([\s\S]*)<\/body>/i, (_, attributes, content) => {
        // The access bootstrap owns the single auth client and configuration.
        const body = content.replace(/<script\b[^>]*src="(?:https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"\s]+|config\.js[^"\s]*)"[^>]*>[\s\S]*?<\/script>/gi, '');
        return `<body${attributes}>
<section id="site-access-gate" class="site-access-gate" aria-labelledby="site-access-title">
 <div class="site-access-card"><img src="assets/icons/sigma.svg" alt="" width="40" height="40"><p class="site-access-brand">SCIP/LAB</p>
 <h1 id="site-access-title">正在验证访问权限</h1><p id="site-access-message" role="status" aria-live="polite">请稍候…</p>
 <div class="site-access-actions"><button type="button" id="site-access-signin" disabled>使用 GitHub 登录</button><button type="button" id="site-access-retry" hidden>重试验证</button><button type="button" id="site-access-signout" hidden>切换账号</button></div>
 <noscript><p>请启用 JavaScript 后使用 GitHub 登录。</p></noscript></div>
</section>
<template id="site-protected-content">${body}</template>
<link rel="stylesheet" href="styles/access.css?v=1">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.min.js"></script>
<script src="config.js?v=access1"></script>
<script src="js/access.js?v=1"></script>
</body>`;
    });
}

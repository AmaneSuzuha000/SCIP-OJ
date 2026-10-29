/* The original body stays inert until server-side admission succeeds. */
export function protectPage(html) {
    return html.replace(/<body([^>]*)>([\s\S]*)<\/body>/i, (_, attributes, content) => {
        // The access bootstrap owns the single auth client and configuration.
        const body = content.replace(/<script\b[^>]*src="(?:https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"\s]+|config\.js[^"\s]*)"[^>]*>[\s\S]*?<\/script>/gi, '');
        return `<body${attributes}>
<section id="site-access-gate" class="site-access-gate" aria-labelledby="site-access-title">
 <div class="site-access-card"><img src="assets/icons/sigma.svg" alt="" width="40" height="40"><p class="site-access-brand">SCIP/LAB</p>
 <p class="site-access-kicker">西南交通大学 · 工业工程《系统建模与仿真》</p>
 <h1 id="site-access-title">正在验证访问权限</h1><p id="site-access-message" role="status" aria-live="polite">请稍候…</p>
 <p id="site-access-destination" class="site-access-destination" hidden></p>
 <p class="site-access-note">「已获授权账号」指课程测试白名单中的 GitHub 身份。测试期间请使用任课教师登记过的账号；其他 GitHub 账号登录后仍无法进入。</p>
 <p class="site-access-guide"><a href="docs/学生指南.md">阅读学生指南</a></p>
 <div class="site-access-actions"><button type="button" id="site-access-signin" class="ui-button ui-button--primary" disabled>使用 GitHub 登录</button><button type="button" id="site-access-retry" class="ui-button ui-button--secondary" hidden>重试验证</button><button type="button" id="site-access-signout" class="ui-button ui-button--ghost" hidden>切换账号</button></div>
 <noscript><p>请启用 JavaScript 后使用 GitHub 登录。</p></noscript></div>
</section>
<template id="site-protected-content">${body}</template>
<link rel="stylesheet" href="styles/access.css?v=gate2">
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.min.js"></script>
<script src="config.js?v=access1"></script>
<script src="js/access.js?v=gate2"></script>
</body>`;
    });
}

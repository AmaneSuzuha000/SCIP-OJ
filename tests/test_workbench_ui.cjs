"use strict";
/* Safeguards for the independent course-first UI: DOM contract, routing and content honesty.
 * No browser or external dependencies required; GitHub Actions runs this test on every PR.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..", "site");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "workbench-v3.css"), "utf8");

for (const id of [
  "main-content", "auth-area", "teacher-link", "current-course-banner",
  "banner-course-title", "banner-course-desc", "banner-course-action",
  "btn-banner-join-course", "overview-problems", "problem-list-section",
  "problem-list", "problem-count", "problem-search-input", "filter-difficulty",
  "filter-progress", "view-list", "view-grid", "workspace", "btn-back-to-list",
  "btn-prev-problem", "btn-next-problem", "title", "readme", "history-tab",
  "assignment-meta-bar", "code", "status", "btn-grade", "btn-submit-formal",
  "testcase-input", "btn-run-testcase", "result-panel", "report",
  "my-submissions-container", "btn-show-leaderboard", "btn-refresh-submissions"
]) {
  assert.match(html, new RegExp('\\bid="' + id + '"'), "Missing JS DOM hook: " + id);
}
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(ids.length, new Set(ids).size, "Duplicate HTML IDs would make DOM bindings unreliable");
for (const [id, url] of [
  ["case-studio", "case-studio.html"],
  ["inventory", "inventory-lab.html"],
  ["flow", "flow-lab.html"]
]) {
  assert.ok(fs.existsSync(path.join(root, url)), "Missing teaching case: " + id);
  assert.ok(html.includes('href="' + url + '"') ||
            html.includes('href="' + url + '#experiment"'), "Case not linked: " + id);
}
assert.match(html, /class="studio-rail"/, "Expected the dedicated workbench navigation");
assert.match(html, /class="studio-case-grid"/, "Expected three runnable case cards");
assert.match(html, /<strong>03<\/strong>\s*<span>可运行仿真实验/, "Case count must be 3, not stale 1");
assert.match(html, /id="teacher-link"[^>]*hidden/, "Teacher navigation must remain permission gated");
assert.ok(html.indexOf('href="workbench-v3.css"') > html.indexOf('href="case-entry.css"'),
  "Course workbench overrides must load after prior styles");
assert.ok(html.indexOf('src="js/platform.js') < html.indexOf('src="js/app.js'),
  "Existing authentication and judge script dependency order must remain");
assert.match(html, /#problem-list-section/, "OJ section navigation lost");
assert.match(css, /workbench-active[\s\S]*?studio-case-section\s*\{\s*display:none/,
  "Opening a problem should hide the course landing instead of burying the editor");
assert.match(css, /@media\s*\(max-width:840px\)/, "Missing navigation mobile adaptation");
assert.match(css, /@media\s*\(max-width:650px\)/, "Missing small-screen layout");
assert.equal((html.match(/<main\b/g)||[]).length, (html.match(/<\/main>/g)||[]).length,
  "Unbalanced main landmark");
console.log("Independent SCIP/LAB course UI contract: PASS");

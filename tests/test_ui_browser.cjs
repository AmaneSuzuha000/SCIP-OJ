"use strict";
/* Independent UI smoke test: no sign-in, no grading, no mutations to course records. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { chromium } = require("playwright");

const origin = process.env.SCIP_UI_TEST_ORIGIN || "http://127.0.0.1:8765";
const out = path.resolve(process.env.SCIP_UI_SCREENSHOT_DIR || "ui-artifacts");
fs.mkdirSync(out, { recursive: true });

async function screenshot(page, file) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  await page.screenshot({ path: path.join(out, file), fullPage: true, animations: "disabled" });
}

async function assertFits(page, label) {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth
  }));
  assert.ok(dimensions.scrollWidth <= dimensions.innerWidth + 2,
    label + " horizontal overflow: " + JSON.stringify(dimensions));
  const content = await page.evaluate(() => {
    const main = document.querySelector(".studio-content");
    if (!main) return null;
    const rect = main.getBoundingClientRect();
    return { left: rect.left, width: rect.width, right: rect.right, viewport: window.innerWidth };
  });
  if (content) {
    assert.ok(Math.abs(content.right - content.viewport) <= 2,
      label + " content must fill the available width: " + JSON.stringify(content));
    if (content.viewport <= 840) assert.ok(content.width >= content.viewport - 2,
      label + " must not retain the desktop sidebar width: " + JSON.stringify(content));
  }
}

async function download(page, selector, name) {
  const pending = page.waitForEvent("download");
  await page.locator(selector).click();
  const item = await pending;
  const file = path.join(out, name);
  await item.saveAs(file);
  return file;
}

function verifyManifest(file) {
  const result = spawnSync("python3", ["-m", "judge.ie_des01_reference", file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "VERIFIED_REPLAY");
}

async function run() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const browserErrors = [];
    desktop.on("pageerror", error => browserErrors.push("pageerror: " + error.message));
    desktop.on("console", message => { if (message.type() === "error") browserErrors.push("console: " + message.text()); });
    await desktop.goto(origin + "/index.html", { waitUntil: "domcontentloaded" });
    assert.match(await desktop.title(), /SCIP\/LAB/);
    assert.equal(await desktop.locator(".studio-case-card").count(), 3);
    await screenshot(desktop, "00-diagnostic-home-before-load.png");
    try {
      await desktop.locator("#problem-list .problem-card").first().waitFor({ state: "attached", timeout: 25000 });
    } catch (error) {
      console.error("Browser diagnostics:", JSON.stringify({
        readyState: await desktop.evaluate(() => document.readyState),
        location: desktop.url(),
        list: await desktop.locator("#problem-list").innerText(),
        scripts: await desktop.evaluate(() => [...document.scripts].map(s => ({ src: s.src, loaded: !!s.readyState }))),
        errors: browserErrors
      }, null, 2));
      throw error;
    }
    assert.equal(await desktop.locator("#teacher-link").isVisible(), false,
      "Teacher navigation should be hidden before authorization");
    await assertFits(desktop, "Desktop home");
    await screenshot(desktop, "01-course-workbench-desktop.png");

    await desktop.locator("#nav-course-space").click();
    await desktop.locator("#course-space").waitFor({ state: "visible" });
    assert.equal(await desktop.locator("#learning-space").isVisible(), false);
    assert.equal(await desktop.locator("#nav-course-space").getAttribute("aria-current"), "page");
    assert.equal(await desktop.locator(".course-case-row").count(), 3);
    await desktop.locator(".skip-link").focus();
    await desktop.locator(".skip-link").click();
    assert.equal(await desktop.locator("#course-space").isVisible(), true,
      "Skip-to-content must keep the selected course space");
    assert.equal(await desktop.evaluate(() => document.activeElement.id), "main-content");
    await assertFits(desktop, "Course space");
    await screenshot(desktop, "08-course-space.png");
    await desktop.locator("#nav-learning-space").click();
    await desktop.locator('.learning-overview').waitFor({ state: "visible" });
    await desktop.locator('[data-route="submissions"]').click();
    await desktop.locator("#submission-overview").waitFor({ state: "visible" });
    assert.equal(await desktop.locator("#submissions-host #my-submissions-section").count(), 1);
    assert.equal(await desktop.locator(".learning-overview").isVisible(), false);
    assert.equal(await desktop.locator("#btn-show-leaderboard").isVisible(), false);
    await desktop.evaluate(() => renderSubmissionsTable(document.getElementById("my-submissions-container"), [{
      id: "qa-only", public_code: "QA-ONLY", assignment_id: "qa-assignment", attempt_no: 1,
      assignments: { problem_id: "P001", courses: { name: "测试班级", code: "QA-ONLY" } },
      gradings: [{ status: "done", score: 65, passed: true }]
    }]));
    assert.match(await desktop.locator(".submission-context").innerText(), /P001.*背包[\s\S]*测试班级/);
    assert.equal(await desktop.locator(".submissions-table strong.pass").innerText(), "65 分",
      "Submission colors follow the server passed field, rather than an assumed 90-point threshold");
    await desktop.locator("#btn-refresh-submissions").click();
    await desktop.locator("#nav-to-assessment").click();
    await desktop.locator("#problem-list-section").waitFor({ state: "visible" });

    await desktop.locator("#problem-list .problem-card").first().click();
    await desktop.waitForFunction(() => document.body.classList.contains("workbench-active"), { timeout: 10000 });
    await desktop.locator("#title").waitFor({ state: "visible", timeout: 15000 });
    await desktop.waitForFunction(() => (document.getElementById("title")?.textContent || "").length > 3);
    assert.equal(await desktop.locator(".studio-intro").isVisible(), false,
      "Course hero should not push editor out of view when solving");
    assert.equal(await desktop.locator("#grading-rules").count(), 1);
    await assertFits(desktop, "Desktop editor");
    await screenshot(desktop, "02-code-workbench.png");

    // The top-level space switch must protect exam drafts as well as the sidebar.
    await desktop.evaluate(() => {
      window.ScipOJExam.activate("exam_warn", "P001");
      window.ScipOJEditor.setValue(window.ScipOJEditor.getValue() + "\n# exam-navigation-regression\n");
    });
    await desktop.locator("#nav-course-space").click();
    await desktop.locator("#confirm-dialog").waitFor({ state: "visible" });
    await desktop.locator("#confirm-cancel").click();
    await desktop.waitForURL(/#P001$/);
    assert.equal(await desktop.locator("#workspace").isVisible(), true);
    assert.equal(await desktop.locator("#course-space").isVisible(), false);
    assert.ok(await desktop.evaluate(() => window.ScipOJEditor.getValue().includes("exam-navigation-regression")));
    await desktop.locator("#nav-course-space").click();
    await desktop.locator("#confirm-ok").click();
    await desktop.locator("#course-space").waitFor({ state: "visible" });
    await desktop.locator("#nav-learning-space").click();
    await desktop.locator('.learning-overview').waitFor({ state: "visible" });
    await desktop.locator("#nav-to-assessment").click();
    await desktop.locator("#problem-list-section").waitFor({ state: "visible" });
    await desktop.locator("#problem-list .problem-card").first().click();
    await desktop.locator("#title").waitFor({ state: "visible" });
    await desktop.evaluate(() => {
      window.ScipOJExam.activate("exam_warn", "P001");
      window.ScipOJEditor.setValue(window.ScipOJEditor.getValue() + "\n# next-problem-regression\n");
    });
    await desktop.locator("#btn-next-problem").click();
    await desktop.locator("#confirm-dialog").waitFor({ state: "visible" });
    await desktop.locator("#confirm-ok").click();
    await desktop.waitForFunction(() => document.getElementById("title").textContent.startsWith("P002"));
    assert.equal(await desktop.locator("#confirm-dialog").isVisible(), false,
      "Changing problems should ask once before discarding an exam draft");
    await desktop.locator("#nav-to-assessment").click();
    assert.equal(await desktop.locator("#workspace").isVisible(), false);
    assert.equal(await desktop.locator("#problem-list-section").isVisible(), true);
    assert.match(desktop.url(), /#problem-list-section$/,
      "Sidebar must update the URL without a shadowed History API error");
    await desktop.locator("#problem-list .problem-card").first().click();
    await desktop.locator("#workspace").waitFor({ state: "visible" });
    await desktop.locator("#btn-back-to-list").click();
    assert.equal(await desktop.locator("#workspace").isVisible(), false);
    assert.equal(await desktop.locator("#problem-list-section").isVisible(), true);

    await desktop.locator("#problem-list .problem-card").first().click();
    await desktop.waitForFunction(() => document.getElementById("title").textContent.startsWith("P001"));
    // A slow assignment response must not re-enable exam policy after switching spaces.
    await desktop.evaluate(() => {
      const platform = window.ScipOJPlatform;
      const originalConfigured = platform.isConfigured, originalLookup = platform.getAssignmentForProblem;
      platform.isConfigured = () => true;
      platform.getAssignmentForProblem = () => new Promise(resolve => { window.__resolveAssignment = resolve; });
      window.__assignmentRefresh = refreshAssignmentMeta("P001");
      window.__restoreAssignmentLookup = () => { platform.isConfigured = originalConfigured; platform.getAssignmentForProblem = originalLookup; };
    });
    await desktop.locator("#nav-course-space").click();
    await desktop.locator("#course-space").waitFor({ state: "visible" });
    await desktop.evaluate(async () => {
      window.__resolveAssignment({ id: "qa-only", integrity_policy: "exam_block" });
      await window.__assignmentRefresh;
      window.__restoreAssignmentLookup();
    });
    assert.equal(await desktop.evaluate(() => window.ScipOJExam.getPolicy()), "standard");
    assert.equal(await desktop.locator("#workspace").isVisible(), false);

    const lab = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    lab.on("pageerror", error => browserErrors.push("lab pageerror: " + error.message));
    await lab.goto(origin + "/case-studio.html#experiment", { waitUntil: "domcontentloaded" });
    await lab.locator("#experiment-form button[type=submit]").click();
    await lab.waitForFunction(() => {
      const v = document.querySelector("#wait-a")?.textContent?.trim();
      return v && v !== "—";
    }, { timeout: 15000 });
    await assertFits(lab, "Queue lab");
    const evidence = await download(lab, "#export-json-button", "queue-browser-export.json");
    verifyManifest(evidence);
    await lab.locator("#serversB").fill("4");
    assert.equal(await lab.locator("#export-json-button").isEnabled(), false);
    assert.equal(await lab.locator("#export-button").isEnabled(), false);
    await lab.locator("#experiment-form button[type=submit]").click();
    const rerun = await download(lab, "#export-json-button", "queue-browser-rerun.json");
    assert.equal(JSON.parse(fs.readFileSync(rerun, "utf8")).params.serversB, 4);
    verifyManifest(rerun);
    await screenshot(lab, "03-queue-simulation.png");

    for (const [pageName, field, newValue] of [
      ["inventory-lab", "targetB", "15"], ["flow-lab", "bufferB", "4"]
    ]) {
      await lab.goto(origin + "/" + pageName + ".html", { waitUntil: "domcontentloaded" });
      await lab.waitForFunction(() => !document.getElementById("export-button").disabled);
      await download(lab, "#export-button", pageName + ".csv");
      await lab.locator("#" + field).fill(newValue);
      assert.equal(await lab.locator("#export-button").isEnabled(), false,
        pageName + " must not export obsolete results under edited parameters");
      await lab.locator("#run-button").click();
      await lab.waitForFunction(() => !document.getElementById("export-button").disabled);
      await assertFits(lab, pageName);
      await screenshot(lab, pageName + ".png");
    }

    const teacher = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await teacher.goto(origin + "/teacher.html", { waitUntil: "domcontentloaded" });
    assert.equal(await teacher.locator("#teacher-panel").isVisible(), false,
      "Anonymous users cannot see gradebook or release controls");
    await screenshot(teacher, "04-faculty-access.png");

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    mobile.on("pageerror", error => browserErrors.push("mobile pageerror: " + error.message));
    await mobile.goto(origin + "/index.html", { waitUntil: "domcontentloaded" });
    await mobile.locator(".studio-case-card").first().waitFor({ state: "visible" });
    assert.equal(await mobile.locator(".studio-case-card").count(), 3);
    await mobile.locator("#problem-list .problem-card").first().waitFor({ state: "attached" });
    await assertFits(mobile, "Mobile home");
    const phoneNav = await mobile.locator('#rail-primary [data-space-nav="learn"] a').evaluateAll(
      links => links.map(link => ({ left: link.getBoundingClientRect().left, right: link.getBoundingClientRect().right })));
    assert.ok(phoneNav.every(box => box.left >= 0 && box.right <= 390),
      "Every primary mobile entry, including submissions, must be visible without horizontal scrolling");
    await screenshot(mobile, "05-course-workbench-mobile.png");
    await mobile.locator("#btn-course-menu").click();
    assert.equal(await mobile.locator("#btn-course-menu").getAttribute("aria-expanded"), "true");
    assert.equal(await mobile.locator('#rail-resources a[href="official-examples.html"]').isVisible(), true);
    assert.equal(await mobile.locator('#rail-services a[href="doc.html?f=学生指南.md"]').isVisible(), true);
    assert.equal(await mobile.locator("#teacher-link").isVisible(), false);
    await mobile.locator("#btn-course-menu").click();
    await mobile.locator("#nav-course-space").click();
    await mobile.locator("#course-space").waitFor({ state: "visible" });
    await assertFits(mobile, "Mobile course space");
    await mobile.locator("#nav-learning-space").click();
    await mobile.locator("#nav-to-assessment").click();
    await mobile.locator("#problem-list-section").waitFor({ state: "visible" });
    await mobile.locator("#problem-list .problem-card").first().click();
    await mobile.locator("#workspace").waitFor({ state: "visible" });
    assert.equal(await mobile.locator(".workspace-layout").evaluate(
      node => getComputedStyle(node).gridTemplateColumns.split(" ").length), 1,
      "Phone editor must use a single column");
    await assertFits(mobile, "Mobile editor");
    await screenshot(mobile, "06-code-workbench-mobile.png");

    const tablet = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    tablet.on("pageerror", error => browserErrors.push("tablet pageerror: " + error.message));
    await tablet.goto(origin + "/index.html", { waitUntil: "domcontentloaded" });
    await tablet.locator("#problem-list .problem-card").first().waitFor({ state: "attached" });
    await tablet.locator("#nav-to-assessment").click();
    await tablet.locator("#problem-list-section").waitFor({ state: "visible" });
    await tablet.locator("#problem-list .problem-card").first().click();
    await tablet.locator("#workspace").waitFor({ state: "visible" });
    await assertFits(tablet, "Tablet editor");
    assert.equal(await tablet.locator(".workspace-layout").evaluate(
      node => getComputedStyle(node).gridTemplateColumns.split(" ").length), 1);
    await screenshot(tablet, "07-code-workbench-tablet.png");
    assert.deepEqual(browserErrors.filter(message => message.includes("pageerror:")), [],
      "Uncaught page errors must fail UI acceptance");
    console.log("SCIP/LAB Chromium acceptance: PASS (responsive editor, navigation, 3 labs, real downloads, independent replay)");
  } finally {
    await browser.close();
  }
}
run().catch(err => { console.error(err); process.exitCode = 1; });

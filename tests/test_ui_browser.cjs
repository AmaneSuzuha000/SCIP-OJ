"use strict";
/* Independent UI smoke test: no sign-in, no grading, no mutations to course records. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const origin = process.env.SCIP_UI_TEST_ORIGIN || "http://127.0.0.1:8765";
const out = path.resolve(process.env.SCIP_UI_SCREENSHOT_DIR || "ui-artifacts");
fs.mkdirSync(out, { recursive: true });

async function screenshot(page, file) {
  await page.screenshot({ path: path.join(out, file), fullPage: true, animations: "disabled" });
}

async function run() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await desktop.goto(origin + "/index.html", { waitUntil: "domcontentloaded" });
    assert.match(await desktop.title(), /SCIP\/LAB/);
    assert.equal(await desktop.locator(".studio-case-card").count(), 3);
    await desktop.locator("#problem-list .problem-card").first().waitFor({ state: "visible", timeout: 25000 });
    assert.equal(await desktop.locator("#teacher-link").isVisible(), false,
      "Teacher navigation should be hidden before authorization");
    await screenshot(desktop, "01-course-workbench-desktop.png");

    await desktop.locator("#problem-list .problem-card").first().click();
    await desktop.waitForFunction(() => document.body.classList.contains("workbench-active"), { timeout: 10000 });
    await desktop.locator("#title").waitFor({ state: "visible", timeout: 15000 });
    await desktop.waitForFunction(() => (document.getElementById("title")?.textContent || "").length > 3);
    assert.equal(await desktop.locator(".studio-intro").isVisible(), false,
      "Course hero should not push editor out of view when solving");
    assert.equal(await desktop.locator("#grading-rules").count(), 1);
    await screenshot(desktop, "02-code-workbench.png");
    await desktop.locator("#btn-back-to-list").click();
    assert.equal(await desktop.locator("#workspace").isVisible(), false);
    assert.equal(await desktop.locator("#problem-list-section").isVisible(), true);

    const lab = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await lab.goto(origin + "/case-studio.html#experiment", { waitUntil: "domcontentloaded" });
    await lab.locator("#experiment-form button[type=submit]").click();
    await lab.waitForFunction(() => {
      const v = document.querySelector("#wait-a")?.textContent?.trim();
      return v && v !== "—";
    }, { timeout: 15000 });
    await screenshot(lab, "03-queue-simulation.png");

    const teacher = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await teacher.goto(origin + "/teacher.html", { waitUntil: "domcontentloaded" });
    assert.equal(await teacher.locator("#teacher-panel").isVisible(), false,
      "Anonymous users cannot see gradebook or release controls");
    await screenshot(teacher, "04-faculty-access.png");

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await mobile.goto(origin + "/index.html", { waitUntil: "domcontentloaded" });
    await mobile.locator(".studio-case-card").first().waitFor({ state: "visible" });
    assert.equal(await mobile.locator(".studio-case-card").count(), 3);
    const dimensions = await mobile.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    }));
    assert.ok(dimensions.scrollWidth <= dimensions.innerWidth + 2,
      "Unexpected horizontal overflow on mobile: " + JSON.stringify(dimensions));
    await screenshot(mobile, "05-course-workbench-mobile.png");
    console.log("SCIP/LAB real Chromium UI smoke: PASS (desktop, editor, simulation, faculty, mobile)");
  } finally {
    await browser.close();
  }
}
run().catch(err => { console.error(err); process.exitCode = 1; });

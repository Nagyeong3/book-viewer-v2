import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.UI_BASE_URL ?? "http://127.0.0.1:3000";
const outputDir = path.resolve(process.cwd(), "ui-artifacts");
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });

const report = {
  baseUrl,
  checks: {},
  measurements: {},
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

try {
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60_000 });
  await page.locator(".chapter-page-paper").first().waitFor({ state: "visible", timeout: 30_000 });
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });

  const bodyMetrics = await page.evaluate(() => ({
    width: window.innerWidth,
    bodyScrollWidth: document.documentElement.scrollWidth,
    bodyScrollHeight: document.documentElement.scrollHeight,
  }));
  report.measurements.body1600 = bodyMetrics;
  assert(bodyMetrics.bodyScrollWidth <= bodyMetrics.width + 2, `Global horizontal overflow at 1600px: ${bodyMetrics.bodyScrollWidth} > ${bodyMetrics.width}`);
  report.checks.noGlobalOverflow1600 = true;

  const level1 = page.locator(".semantic-heading-1").first();
  const level2 = page.locator(".semantic-heading-2").first();
  await level1.waitFor({ state: "visible", timeout: 15_000 });
  await level2.waitFor({ state: "visible", timeout: 15_000 });
  const headingTags = {
    level1: await level1.evaluate((el) => el.tagName),
    level2: await level2.evaluate((el) => el.tagName),
  };

  const scroller = page.locator(".chapter-scroll");
  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(700);
  const level3 = page.locator(".semantic-heading-3").first();
  await level3.waitFor({ state: "visible", timeout: 15_000 });
  headingTags.level3 = await level3.evaluate((el) => el.tagName);
  report.measurements.headingTags = headingTags;
  assert(headingTags.level1 === "H2" && headingTags.level2 === "H3" && headingTags.level3 === "H4",
    `Heading mapping mismatch: ${JSON.stringify(headingTags)}`);
  report.checks.headingHierarchy = true;

  await scroller.evaluate((el) => { el.scrollTop = 0; el.scrollLeft = 0; });
  await page.waitForTimeout(250);

  const textBlock = page.locator(".coordinate-block.type-text").first();
  await textBlock.waitFor({ state: "visible", timeout: 15_000 });
  const partialPressed = await page.getByRole("button", { name: /부분 번역/ }).getAttribute("aria-pressed");
  assert(partialPressed === "false", "Partial translation must start OFF for hover validation.");
  await textBlock.hover();
  await page.waitForTimeout(120);
  const hoverStyle = await textBlock.evaluate((el) => {
    const style = getComputedStyle(el);
    return { borderColor: style.borderColor, boxShadow: style.boxShadow, backgroundColor: style.backgroundColor };
  });
  report.measurements.partialTranslationOffHover = hoverStyle;
  assert(hoverStyle.boxShadow === "none", `Unexpected hover shadow while partial translation is OFF: ${hoverStyle.boxShadow}`);
  assert(hoverStyle.borderColor === "rgba(0, 0, 0, 0)" || hoverStyle.borderColor === "transparent",
    `Unexpected hover border while partial translation is OFF: ${hoverStyle.borderColor}`);
  report.checks.translationOffHoverInvisible = true;
  await page.screenshot({ path: path.join(outputDir, "ui-hover-off-1600x1000.png"), fullPage: false });

  await page.mouse.move(10, 10);
  const firstPaper = page.locator(".chapter-page-paper").first();
  const beforeBox = await firstPaper.boundingBox();
  assert(beforeBox, "Could not measure document page before zoom.");
  await scroller.evaluate((el) => {
    el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) * 0.25);
    el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) * 0.5);
  });
  const centerBefore = await scroller.evaluate((el) => ({
    x: (el.scrollLeft + el.clientWidth / 2) / Math.max(el.scrollWidth, el.clientWidth),
    y: (el.scrollTop + el.clientHeight / 2) / Math.max(el.scrollHeight, el.clientHeight),
  }));

  await page.getByRole("button", { name: "확대" }).click();
  await page.getByRole("button", { name: "확대" }).click();
  await page.waitForTimeout(450);
  const afterBox = await firstPaper.boundingBox();
  assert(afterBox, "Could not measure document page after zoom.");
  const centerAfter = await scroller.evaluate((el) => ({
    x: (el.scrollLeft + el.clientWidth / 2) / Math.max(el.scrollWidth, el.clientWidth),
    y: (el.scrollTop + el.clientHeight / 2) / Math.max(el.scrollHeight, el.clientHeight),
  }));
  report.measurements.zoom = { beforeWidth: beforeBox.width, afterWidth: afterBox.width, centerBefore, centerAfter };
  assert(afterBox.width > beforeBox.width * 1.15, `Zoom did not enlarge the page enough: ${beforeBox.width} -> ${afterBox.width}`);
  assert(Math.abs(centerAfter.x - centerBefore.x) < 0.08, `Horizontal centre shifted too much: ${centerBefore.x} -> ${centerAfter.x}`);
  assert(Math.abs(centerAfter.y - centerBefore.y) < 0.10, `Vertical centre shifted too much: ${centerBefore.y} -> ${centerAfter.y}`);
  report.checks.zoomEnlargesDocument = true;
  report.checks.zoomPreservesViewportCentre = true;
  await page.screenshot({ path: path.join(outputDir, "ui-zoom-120-1600x1000.png"), fullPage: false });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(350);
  const compactMetrics = await page.evaluate(() => ({
    width: window.innerWidth,
    bodyScrollWidth: document.documentElement.scrollWidth,
    toolbar: (() => {
      const el = document.querySelector(".viewer-toolbar");
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, viewportWidth: window.innerWidth };
    })(),
  }));
  report.measurements.body1366 = compactMetrics;
  assert(compactMetrics.bodyScrollWidth <= compactMetrics.width + 2,
    `Global horizontal overflow at 1366px: ${compactMetrics.bodyScrollWidth} > ${compactMetrics.width}`);
  assert(!compactMetrics.toolbar || (compactMetrics.toolbar.left >= -1 && compactMetrics.toolbar.right <= compactMetrics.toolbar.viewportWidth + 1),
    `Viewer toolbar escapes viewport: ${JSON.stringify(compactMetrics.toolbar)}`);
  report.checks.noGlobalOverflow1366 = true;
  await page.screenshot({ path: path.join(outputDir, "ui-final-1366x768.png"), fullPage: false });

  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outputDir, "ui-final-1600x1000.png"), fullPage: false });

  await fs.writeFile(path.join(outputDir, "ui-smoke-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}

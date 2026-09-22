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

  // Stored whole-document translation choices must come from the active document's DB keys.
  const fullLanguageSelect = page.getByLabel("전체 번역 언어");
  await fullLanguageSelect.waitFor({ state: "visible", timeout: 15_000 });
  const document101Languages = await fullLanguageSelect.locator("option").evaluateAll((options) =>
    options.map((option) => option.value).filter(Boolean),
  );
  report.measurements.document101TranslationLanguages = document101Languages;
  assert(JSON.stringify(document101Languages) === JSON.stringify(["en", "fil", "pl"]),
    `Document 101 translation keys mismatch: ${JSON.stringify(document101Languages)}`);

  // A row missing the selected translation must keep its original text.
  await fullLanguageSelect.selectOption("pl");
  await page.getByRole("button", { name: "전체 번역" }).click();
  await page.waitForTimeout(150);
  const translatedHeading = await page.locator("#content-1102").innerText();
  const fallbackBody = await page.locator("#content-1103").innerText();
  assert(translatedHeading.includes("[PL]"), `Expected stored Polish translation, got: ${translatedHeading}`);
  assert(fallbackBody.includes("본 교범은 항공기 후속지원 업무를 위한 샘플 문서입니다."),
    `Missing-row fallback did not preserve original text: ${fallbackBody}`);
  report.checks.fullTranslationUsesStoredKeys = true;
  report.checks.fullTranslationFallsBackPerRow = true;
  await page.getByRole("button", { name: "전체 번역" }).click();

  // Per-document language sets must change when another document is opened.
  await page.locator(".document-item").filter({ hasText: "지원장비 운용교범 샘플" }).click();
  await page.waitForTimeout(250);
  const document102Languages = await fullLanguageSelect.locator("option").evaluateAll((options) =>
    options.map((option) => option.value).filter(Boolean),
  );
  report.measurements.document102TranslationLanguages = document102Languages;
  assert(JSON.stringify(document102Languages) === JSON.stringify(["en"]),
    `Document 102 translation keys mismatch: ${JSON.stringify(document102Languages)}`);
  report.checks.translationLanguagesAreDocumentScoped = true;
  await page.locator(".document-item").filter({ hasText: "LAH 정비교범 샘플" }).click();
  await page.locator("#content-1103").waitFor({ state: "visible", timeout: 15_000 });

  // Partial translation exposes only the requested presets plus a direct-input option.
  await page.getByRole("button", { name: "부분 번역" }).click();
  const partialLanguageSelect = page.getByLabel("부분 번역 언어");
  const partialOptions = await partialLanguageSelect.locator("option").evaluateAll((options) =>
    options.map((option) => option.value),
  );
  const expectedPartialOptions = ["en", "ko", "fil", "pl", "ja", "ar-SA", "__custom__"];
  report.measurements.partialTranslationOptions = partialOptions;
  assert(JSON.stringify(partialOptions) === JSON.stringify(expectedPartialOptions),
    `Partial translation options mismatch: ${JSON.stringify(partialOptions)}`);
  assert(!partialOptions.some((value) => value.startsWith("zh")), "Chinese must not be exposed in partial translation.");

  await partialLanguageSelect.selectOption("__custom__");
  const customLanguageInput = page.getByLabel("직접 입력 번역 언어");
  await customLanguageInput.fill("베트남어");
  await page.locator("#content-1103").click();
  await page.locator(".translation-result").waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(() => !document.querySelector(".translation-loading"), null, { timeout: 10_000 });
  const customTranslation = await page.locator(".translation-result").innerText();
  assert(customTranslation.includes("[Mock 베트남어]"), `Custom language translation failed: ${customTranslation}`);
  report.checks.partialTranslationPresetList = true;
  report.checks.partialTranslationCustomTarget = true;
  await page.getByRole("button", { name: "번역 패널 닫기" }).click();
  await page.getByRole("button", { name: "부분 번역" }).click();

  // Print is immediately left of the AI reopen action, and utility labels match translation control sizing.
  await page.getByRole("button", { name: "AI 비서 접기" }).click();
  const printButton = page.getByRole("button", { name: /인쇄/ });
  const aiOpenButton = page.getByRole("button", { name: /AI 비서 열기/ });
  const vectorButton = page.getByRole("button", { name: /벡터 DB/ });
  await aiOpenButton.waitFor({ state: "visible", timeout: 5_000 });
  const [printBox, aiBox] = await Promise.all([printButton.boundingBox(), aiOpenButton.boundingBox()]);
  assert(printBox && aiBox && printBox.x < aiBox.x, `Expected print before AI reopen: print=${JSON.stringify(printBox)} ai=${JSON.stringify(aiBox)}`);
  const utilityFontSizes = await page.evaluate(() => {
    const fontSize = (selector) => getComputedStyle(document.querySelector(selector)).fontSize;
    return {
      fullTranslate: fontSize(".full-translate-controls .translate-toggle"),
      print: fontSize(".viewer-print-button"),
      aiOpen: fontSize(".viewer-ai-open-button"),
      vector: fontSize(".topbar-index-button"),
    };
  });
  report.measurements.utilityFontSizes = utilityFontSizes;
  assert(utilityFontSizes.print === utilityFontSizes.fullTranslate, `Print font mismatch: ${JSON.stringify(utilityFontSizes)}`);
  assert(utilityFontSizes.aiOpen === utilityFontSizes.fullTranslate, `AI font mismatch: ${JSON.stringify(utilityFontSizes)}`);
  assert(utilityFontSizes.vector === utilityFontSizes.fullTranslate, `Vector DB font mismatch: ${JSON.stringify(utilityFontSizes)}`);
  report.checks.viewerUtilityOrder = true;
  report.checks.viewerUtilityFontAlignment = true;
  await aiOpenButton.click();

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

  // Return to the default 100% zoom before the final product-layout screenshots.
  await page.getByRole("button", { name: "축소" }).click();
  await page.getByRole("button", { name: "축소" }).click();
  await page.waitForTimeout(350);

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

import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.UI_BASE_URL ?? "http://127.0.0.1:3000";
const output = path.resolve(process.cwd(), "ui-artifacts");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const assert = (value, message) => { if (!value) throw new Error(message); };
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

try {
  await page.addInitScript(() => localStorage.removeItem("book-viewer-prototype-role-v1"));
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60_000 });
  const adminButton = page.getByRole("button", { name: "문서 권한관리" });
  await adminButton.waitFor({ state: "visible", timeout: 15_000 });

  for (const [width, height] of [[1600, 1000], [1366, 768], [768, 900], [375, 667]]) {
    await page.setViewportSize({ width, height });
    await adminButton.click();
    const modal = page.getByRole("dialog", { name: "문서 접근 권한 관리" });
    await modal.waitFor({ state: "visible" });
    await page.locator(".document-access-list button").filter({ hasText: "LAH 정비교범 샘플" }).first().waitFor({ state: "visible" });
    const metrics = await page.evaluate(() => {
      const dialog = document.querySelector(".document-access-dialog");
      const footer = document.querySelector(".document-access-footer");
      const body = document.querySelector(".document-access-body");
      const rect = dialog.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return {
        windowWidth: innerWidth, windowHeight: innerHeight,
        htmlScrollWidth: document.documentElement.scrollWidth,
        dialog: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        footer: { left: footerRect.left, right: footerRect.right, top: footerRect.top, bottom: footerRect.bottom },
        bodyWidth: body.clientWidth, bodyScrollWidth: body.scrollWidth,
        overflowing: Array.from(document.querySelectorAll("body *")).filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && (rect.right > innerWidth + 2 || rect.left < -2);
        }).slice(0, 15).map((element) => ({
          tag: element.tagName,
          cls: typeof element.className === "string" ? element.className : "",
          right: Math.round(element.getBoundingClientRect().right),
          left: Math.round(element.getBoundingClientRect().left),
          width: Math.round(element.getBoundingClientRect().width),
        })),
      };
    });
    assert(metrics.htmlScrollWidth <= width + 2, `Global horizontal overflow at ${width}: ${JSON.stringify(metrics)}`);
    assert(metrics.dialog.left >= -1 && metrics.dialog.right <= width + 1, `Clipped modal at ${width}: ${JSON.stringify(metrics)}`);
    assert(metrics.dialog.top >= -1 && metrics.dialog.bottom <= height + 1, `Clipped modal height at ${width}: ${JSON.stringify(metrics)}`);
    assert(metrics.footer.left >= metrics.dialog.left - 1 && metrics.footer.right <= metrics.dialog.right + 1, `Footer escapes modal ${width}`);
    assert(metrics.bodyScrollWidth <= metrics.bodyWidth + 2, `Modal body horizontal overflow at ${width}: ${JSON.stringify(metrics)}`);
    await page.screenshot({ path: path.join(output, `document-access-${width}x${height}.png`) });
    await page.getByRole("button", { name: "닫기" }).last().click();
  }

  await page.setViewportSize({ width: 1366, height: 768 });
  await adminButton.click();
  await page.getByLabel("접근 허용 그룹").fill("/teams/ips-260703-test\n/teams/ate-example");
  await page.getByLabel("추가 허용 사용자").fill("test-keycloak-sub");
  await page.getByRole("button", { name: "권한 저장" }).click();
  await page.getByText("접근 권한이 저장되었습니다.", { exact: false }).waitFor({ state: "visible" });
  await page.getByRole("button", { name: "닫기" }).last().click();
  await adminButton.click();
  // Reopening triggers an asynchronous GET; verify persisted values after hydration.
  await page.waitForFunction(() => {
    const group = document.querySelector("#document-access-groups");
    const user = document.querySelector("#document-access-users");
    return group?.value.includes("/teams/ate-example") && user?.value.includes("test-keycloak-sub");
  }, null, { timeout: 10000 });
  assert((await page.getByLabel("접근 허용 그룹").inputValue()).includes("/teams/ate-example"), "Saved group policy not restored.");
  assert((await page.getByLabel("추가 허용 사용자").inputValue()).includes("test-keycloak-sub"), "Saved user policy not restored.");
  await page.getByRole("button", { name: "닫기" }).last().click();

  const roleSelect = page.getByLabel("프로토타입 사용자 권한");
  await roleSelect.selectOption("user");
  assert(await adminButton.count() === 0, "Regular users must not see document access admin controls.");
  assert(await page.getByRole("button", { name: /벡터 DB/ }).count() === 0, "Regular users must not see vector DB controls.");
  console.log("Document access responsive smoke passed: 1600/1366/768/375 and admin/user roles.");
} finally {
  await browser.close();
}

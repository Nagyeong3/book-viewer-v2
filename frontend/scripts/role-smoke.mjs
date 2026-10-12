import { chromium } from "playwright";

const baseUrl = process.env.UI_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

try {
  await page.addInitScript(() => localStorage.removeItem("book-viewer-prototype-role-v1"));
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60_000 });

  const roleSelect = page.getByLabel("프로토타입 사용자 권한");
  await roleSelect.waitFor({ state: "visible", timeout: 15_000 });
  assert(await roleSelect.inputValue() === "admin", "Prototype must preserve the existing admin product surface by default.");

  const vectorButton = page.getByRole("button", { name: /벡터 DB/ });
  await vectorButton.waitFor({ state: "visible", timeout: 10_000 });

  await roleSelect.selectOption("user");
  await page.waitForTimeout(150);
  assert(await vectorButton.count() === 0, "General user must not see vector DB management controls.");
  assert(await page.getByRole("button", { name: "전체 번역" }).isVisible(), "General user must keep translation access.");
  assert(await page.getByRole("button", { name: /인쇄/ }).isVisible(), "General user must keep print access.");

  await page.evaluate(() => window.dispatchEvent(new CustomEvent("book-viewer:index-required")));
  await page.getByText("관리자 권한 필요").waitFor({ state: "visible", timeout: 5_000 });
  await page.getByRole("button", { name: "권한 안내 닫기" }).click();

  await roleSelect.selectOption("admin");
  await vectorButton.waitFor({ state: "visible", timeout: 10_000 });
  assert(await vectorButton.isVisible(), "Admin must regain vector DB management controls.");

  console.log("Role-based UI prototype smoke checks passed.");
} finally {
  await browser.close();
}

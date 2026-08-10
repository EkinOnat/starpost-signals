import { chromium } from "@playwright/test";
import { resolve } from "node:path";

const target = process.argv[2] || "https://starpost-signals.vercel.app";
const output = resolve(process.argv[3] || "docs/screenshots/level3-mobile-ui.png");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

await page.goto(target, { waitUntil: "domcontentloaded" });
await page.locator(".mobile-nav button", { hasText: "grants" }).click();
await page.locator(".grants-view").waitFor();
await page.waitForTimeout(4_000);
await page.screenshot({ path: output, fullPage: true });

await browser.close();
console.log(output);

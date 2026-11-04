/**
 * Browser check for "Start from a link": serves the fixture pages on a local
 * port, pastes one of their URLs into /recipes/new on a running app, and
 * walks through to the saved recipe page.
 *
 * Needs Playwright with Chromium available on the module path (it is not a
 * project dependency). Run against a production server started with
 * IMPORT_ALLOW_PRIVATE_URLS=true, because the importer otherwise refuses
 * localhost on purpose:
 *
 *   PGLITE_DATA_DIR=$(mktemp -d) IMPORT_ALLOW_PRIVATE_URLS=true npm start &
 *   APP_URL=http://localhost:3000 node scripts/e2e-import.mjs
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Resolved at runtime so a globally installed Playwright (e.g. via NODE_PATH) works.
const { chromium } = createRequire(import.meta.url)("playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures", "import");
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const SHOTS = process.env.SHOT_DIR ?? null;

const server = http.createServer((req, res) => {
  const file = path.join(fixtures, path.basename(new URL(req.url, "http://x").pathname));
  if (!fs.existsSync(file)) {
    res.writeHead(404).end("nope");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const fixtureBase = `http://127.0.0.1:${server.address().port}`;

let failed = 0;
const check = (cond, msg) => {
  console.log(`${cond ? "ok" : "FAIL"} - ${msg}`);
  if (!cond) failed++;
};

const browser = await chromium.launch();
try {
  // --- API shape and errors, straight from the endpoint ------------------------------
  const post = async (body) => {
    const res = await fetch(`${APP_URL}/api/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };
  let r = await post({ url: "not a url" });
  check(r.status === 400 && /web address/.test(r.json.error), `garbage url -> 400 (${r.json.error})`);
  r = await post({ url: "ftp://example.com/x" });
  check(r.status === 400, `ftp url -> 400 (${r.json.error})`);
  r = await post({});
  check(r.status === 400, `missing url -> 400 (${r.json.error})`);
  r = await post({ url: `${fixtureBase}/no-recipe.html` });
  check(r.status === 422 && /No recipe data found/.test(r.json.error), `page without a recipe -> 422 (${r.json.error})`);
  r = await post({ url: `${fixtureBase}/missing.html` });
  check(r.status === 502 && /HTTP 404/.test(r.json.error), `404 page -> 502 with message (${r.json.error})`);
  r = await post({ url: `${fixtureBase}/graph-sections.html` });
  check(
    r.status === 200 && r.json.method === "jsonld" && r.json.draft.title === "Sunday Lasagna" && r.json.draft.cook_minutes === 90,
    "graph fixture -> 200 jsonld draft",
  );

  // --- the form, in a phone-sized viewport ---------------------------------------------
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`${APP_URL}/recipes/new`, { waitUntil: "networkidle" });
  check(await page.getByRole("heading", { name: "Start from a link" }).isVisible(), "link card is on the new-recipe page");
  check(await page.getByRole("heading", { name: "Start from a photo" }).isVisible(), "photo card still there");
  check(
    (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)),
    "no horizontal overflow at 390px",
  );

  // Inline error first.
  await page.getByLabel("Recipe URL").fill("https://localhost/recipe");
  await page.getByRole("button", { name: "Fetch the recipe" }).click();
  const inlineError = page.getByTestId("import-error");
  await inlineError.waitFor();
  check(/web address|local or private|HTTP|reach/.test(await inlineError.textContent()), `inline error shown: ${await inlineError.textContent()}`);

  // Then the real thing.
  const url = `${fixtureBase}/plain-jsonld.html`;
  await page.getByLabel("Recipe URL").fill(url);
  await page.getByRole("button", { name: "Fetch the recipe" }).click();
  await page.getByTestId("draft-notice").waitFor({ timeout: 15000 });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "import-filled.png"), fullPage: true });

  const notice = await page.getByTestId("draft-notice").textContent();
  check(/Imported from 127\.0\.0\.1/.test(notice) && /search engines/.test(notice), "notice names the host and the method");
  check((await page.getByLabel("Title").inputValue()) === "Weeknight Chicken Tacos", "title pre-filled");
  check((await page.getByLabel("Source URL").inputValue()) === url, "source URL pre-filled");
  check((await page.getByLabel("Prep (min)").inputValue()) === "10", "prep pre-filled");
  check((await page.getByLabel("Cook (min)").inputValue()) === "20", "cook pre-filled");
  check((await page.getByLabel("Serves").inputValue()) === "4", "servings pre-filled");
  check((await page.getByLabel("Effort").inputValue()) === "easy", "effort guessed");
  check((await page.getByLabel("Tags (comma separated)").inputValue()) === "chicken, tacos, weeknight, dinner, mexican", "tags pre-filled");
  const names = await page.getByLabel("Ingredient", { exact: true }).evaluateAll((els) => els.map((e) => e.value));
  check(names.length === 10 && names[0] === "boneless skinless chicken thighs" && names[9] === "Cilantro", `10 ingredient rows (${names.length})`);
  const qtys = await page.getByLabel("Quantity").evaluateAll((els) => els.map((e) => e.value));
  check(qtys[0] === "1.5" && qtys[2] === "1" && qtys[7] === "", "quantities pre-filled");
  const units = await page.getByLabel("Unit").evaluateAll((els) => els.map((e) => e.value));
  check(units[0] === "lb" && units[1] === "tbsp" && units[2] === "can", "units normalized");
  const aisles = await page.getByLabel("Store section").evaluateAll((els) => els.map((e) => e.value));
  check(aisles[0] === "meat" && aisles[4] === "dairy" && aisles[5] === "bakery" && aisles[6] === "spices", "aisles guessed");
  check((await page.getByLabel("Steps (one per line)").inputValue()).startsWith("1. Heat the oil"), "steps pre-filled");
  const payload = JSON.parse(await page.locator('input[name="payload"]').inputValue());
  check(payload.source === "web" && payload.sourceUrl === url, "payload carries source=web and the URL");

  // Save and land on the recipe page.
  await page.getByRole("button", { name: "Save recipe" }).click();
  await page.waitForURL(/\/recipes\/[0-9a-f-]{36}$/, { timeout: 30000 });
  await page.getByRole("heading", { name: "Weeknight Chicken Tacos" }).waitFor();
  const sourceLink = page.getByRole("link", { name: "Source" });
  check((await sourceLink.getAttribute("href")) === url, "recipe page shows the source link");
  check(await page.getByText("boneless skinless chicken thighs").first().isVisible(), "ingredients saved");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "import-saved.png"), fullPage: true });
  console.log("saved at", page.url());
} finally {
  await browser.close();
  server.close();
}

if (failed) {
  console.error(`\n${failed} browser check(s) failed`);
  process.exit(1);
}
console.log("\nBrowser import check passed.");

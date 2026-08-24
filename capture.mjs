import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const SITE_BASE = 'https://amitai-new-zealand-trip.amitaywagner.chatgpt.site';
const MANIFEST_URL = `${SITE_BASE}/visual-review/manifest.json`;
const OUT_DIR = path.resolve('screenshots');
const OUT_MANIFEST = path.resolve('visual-review-manifest.json');
const PUBLIC_RAW_BASE = 'https://raw.githubusercontent.com/amitaywagner-beep/new-zealand-trip-visual-review/main';
const PUBLIC_MANIFEST_URL = `${PUBLIC_RAW_BASE}/visual-review-manifest.json`;

await fs.mkdir(OUT_DIR, { recursive: true });

const manifestResp = await fetch(MANIFEST_URL, { cache: 'no-store' });
if (!manifestResp.ok) throw new Error(`Failed to fetch source manifest: ${manifestResp.status}`);
const sourceManifest = await manifestResp.json();

const browser = await chromium.launch({ headless: true });
const results = [];

for (const item of sourceManifest.screenshots ?? []) {
  const viewportMatch = String(item.viewport ?? '1440x1000').match(/(\d+)x(\d+)/);
  const width = viewportMatch ? Number(viewportMatch[1]) : 1440;
  const height = viewportMatch ? Number(viewportMatch[2]) : 1000;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: item.deviceScaleFactor ?? 1,
    hasTouch: Boolean(item.emulateTouch),
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => pageErrors.push(String(err)));
  page.on('requestfailed', req => {
    const url = req.url();
    if (!url.includes('google-analytics') && !url.includes('doubleclick')) {
      failedRequests.push({ url, error: req.failure()?.errorText ?? 'request failed' });
    }
  });

  const reviewPageUrl = new URL(item.url, SITE_BASE).href;
  const fileName = `${item.id}.png`;
  const filePath = path.join(OUT_DIR, fileName);
  const imagePath = `screenshots/${fileName}`;
  const imageUrl = `${PUBLIC_RAW_BASE}/${imagePath}`;
  let success = true;
  let error = null;

  try {
    await page.goto(reviewPageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2500);

    await page.evaluate(async () => {
      const imgs = Array.from(document.images);
      await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(r => {
        img.addEventListener('load', r, { once: true });
        img.addEventListener('error', r, { once: true });
      })));
    }).catch(() => {});
    await page.waitForTimeout(1200);

    if (item.captureTarget) {
      const locator = page.locator(item.captureTarget).first();
      await locator.waitFor({ state: 'visible', timeout: 15000 });
      await locator.screenshot({ path: filePath });
    } else {
      await page.screenshot({ path: filePath, fullPage: Boolean(item.fullPage) });
    }
  } catch (e) {
    success = false;
    error = String(e?.stack ?? e);
  }

  const stat = success ? await fs.stat(filePath).catch(() => null) : null;
  if (success && (!stat || stat.size < 1000)) {
    success = false;
    error = 'Screenshot file missing or unexpectedly small';
  }

  results.push({
    id: item.id,
    reviewPageUrl,
    imagePath,
    imageUrl,
    viewport: item.viewport,
    fullPage: Boolean(item.fullPage),
    screen: item.screen,
    state: item.state,
    capturedAt: new Date().toISOString(),
    success,
    error,
    consoleSummary: {
      consoleErrors: consoleErrors.slice(0, 10),
      pageErrors: pageErrors.slice(0, 10),
      failedRequests: failedRequests.slice(0, 20),
    }
  });

  await context.close();
}

await browser.close();

const output = {
  generatedAt: sourceManifest.generatedAt,
  sourceSiteVersion: sourceManifest.siteVersion,
  captureCompletedAt: new Date().toISOString(),
  mode: 'screenshots',
  captureEnvironment: 'github-actions-playwright',
  sourceManifestUrl: MANIFEST_URL,
  publicManifestUrl: PUBLIC_MANIFEST_URL,
  screenshots: results,
  summary: {
    total: results.length,
    succeeded: results.filter(x => x.success).length,
    failed: results.filter(x => !x.success).length,
  }
};

await fs.writeFile(OUT_MANIFEST, JSON.stringify(output, null, 2), 'utf8');

if (output.summary.failed > 0) {
  console.error(`${output.summary.failed} screenshots failed`);
  process.exitCode = 2;
}

// Manual refresh trigger: 2026-08-24T13:29+03:00

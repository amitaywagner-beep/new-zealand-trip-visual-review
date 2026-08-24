import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const BASE = process.env.VISUAL_REVIEW_BASE_URL || 'https://amitai-new-zealand-v39-ci.amitaywagner.chatgpt.site';
const STORAGE = process.env.PLAYWRIGHT_STORAGE_STATE_PATH || 'playwright-storage-state.json';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: STORAGE, viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

async function hubReady(p) {
  return Boolean(await p.locator('.documents-hub').count()) &&
    Boolean(await p.getByRole('button', { name: /העלאת מסמך/i }).count());
}

try {
  await page.goto(`${BASE}/#bookings`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1200);

  if (!await hubReady(page)) {
    const continueLink = page.getByRole('link', { name: /Continue with ChatGPT/i }).first();
    if (!await continueLink.count()) {
      throw new Error('Continue with ChatGPT link not found on v39 auth gate');
    }

    const popupPromise = context.waitForEvent('page', { timeout: 5000 }).catch(() => null);
    await continueLink.click();
    const popup = await popupPromise;
    const authPage = popup || page;
    await authPage.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    await authPage.waitForTimeout(1500);

    // If ChatGPT shows an OAuth consent/continue step, approve only the normal continuation action.
    for (const re of [/^Continue$/i, /^Allow$/i, /^Authorize$/i, /^המשך$/i, /^אישור$/i]) {
      const button = authPage.getByRole('button', { name: re }).first();
      if (await button.count() && await button.isVisible().catch(() => false)) {
        await button.click();
        break;
      }
    }

    // Give the OAuth redirect time to return to the isolated v39 site.
    for (let i = 0; i < 20; i++) {
      const pages = context.pages();
      const sitePage = pages.find(p => p.url().startsWith(BASE));
      if (sitePage) {
        await sitePage.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        await sitePage.waitForTimeout(500);
        if (await hubReady(sitePage) || !sitePage.getByRole('link', { name: /Continue with ChatGPT/i }).count()) break;
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }

  await context.storageState({ path: STORAGE });
  console.log('Pre-auth completed; refreshed Playwright storage state saved.');
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}

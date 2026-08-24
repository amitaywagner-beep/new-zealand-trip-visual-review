import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const BASE = 'https://amitai-new-zealand-trip.amitaywagner.chatgpt.site';
const out = { generatedAt: new Date().toISOString(), environment: 'github-actions-playwright-chromium', tests: [] };

function record(id, success, details = {}, error = null) {
  out.tests.push({ id, success, error, details });
}

async function ready(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

async function findInteractiveInContext(page, labelRe, contextText) {
  const els = await page.locator('button, a, [role="button"]').all();
  for (const el of els) {
    if (!(await el.isVisible().catch(() => false))) continue;
    const txt = ((await el.innerText().catch(() => '')) || '').trim();
    if (!labelRe.test(txt)) continue;
    const context = await el.evaluate(node => {
      let p = node;
      let text = '';
      for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
        text = (p.innerText || '').trim();
        if (text.length > 40) break;
      }
      return text;
    }).catch(() => '');
    if (!contextText || context.toLowerCase().includes(contextText.toLowerCase())) return { el, txt, context };
  }
  return null;
}

const browser = await chromium.launch({ headless: true });

// Mobile active-trip layout: operational content must be at the top and legacy hero must not precede it.
for (const [id, url, width, height] of [
  ['mobile-now-390-layout', '/visual-review/pages/mobile-now-trip-day-06', 390, 844],
  ['mobile-now-360-layout', '/visual-review/pages/mobile-360-now-trip-day-06', 360, 800],
]) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + url, { timeout: 60000 });
    await ready(page);
    const dashboard = page.locator('.live-daily-dashboard').first();
    const box = await dashboard.boundingBox();
    const heroInfo = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('[class*="hero"], [class*="Hero"]')];
      return candidates.filter(el => {
        const s = getComputedStyle(el); const r = el.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      }).map(el => ({ className: String(el.className), top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height, text: (el.innerText || '').slice(0,120) }));
    });
    const bodyText = await page.locator('body').innerText();
    const hasDay = /יום\s*6/.test(bodyText);
    const hasNext = /הבא|עכשיו/.test(bodyText);
    const legacyTitleVisible = await page.getByText(/המסע של תיצ.?ו וצ.?וקי/).first().isVisible().catch(() => false);
    const success = !!box && box.y < 180 && hasDay && hasNext && !legacyTitleVisible;
    record(id, success, { dashboardBox: box, visibleHeroCandidates: heroInfo, hasDay, hasNext, legacyTitleVisible });
  } catch (e) { record(id, false, {}, String(e)); }
  await ctx.close();
}

// Day 6 -> Hobbiton booking -> back to day 6.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + '/visual-review/pages/day-06-open', { timeout: 60000 }); await ready(page);
    const action = await findInteractiveInContext(page, /פרטי.*הזמנה|הזמנה/, 'Hobbiton');
    if (!action) throw new Error('Could not find Hobbiton booking action');
    await action.el.click(); await page.waitForTimeout(800);
    const bookingVisible = await page.locator('[data-booking-id="hobbiton"]').first().isVisible().catch(() => false);
    const bookingBody = await page.locator('body').innerText();
    record('real-day-to-booking-hobbiton', bookingVisible && /Hobbiton/i.test(bookingBody), { clickedText: action.txt, bookingVisible });

    const back = await findInteractiveInContext(page, /ליום הזה|חזרה.*יום|יום הזה/, 'Hobbiton') || await findInteractiveInContext(page, /ליום הזה|חזרה.*יום|יום הזה/, null);
    if (!back) throw new Error('Could not find booking-to-day action');
    await back.el.click(); await page.waitForTimeout(800);
    const body = await page.locator('body').innerText();
    record('real-booking-to-day-hobbiton', /יום\s*6/.test(body) && /Hobbiton/i.test(body), { clickedText: back.txt });
  } catch (e) {
    if (!out.tests.some(t => t.id === 'real-day-to-booking-hobbiton')) record('real-day-to-booking-hobbiton', false, {}, String(e));
    if (!out.tests.some(t => t.id === 'real-booking-to-day-hobbiton')) record('real-booking-to-day-hobbiton', false, {}, String(e));
  }
  await ctx.close();
}

// Day 6 -> Hobbiton on map.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + '/visual-review/pages/day-06-open', { timeout: 60000 }); await ready(page);
    const action = await findInteractiveInContext(page, /^במפה$|הצגה במפה/, 'Hobbiton');
    if (!action) throw new Error('Could not find Hobbiton map action');
    await action.el.click(); await page.waitForTimeout(1200);
    const mapVisible = await page.locator('.atlas-route-layout').first().isVisible().catch(() => false);
    const body = await page.locator('body').innerText();
    const htmlHasHobbiton = await page.locator('html').evaluate(el => el.outerHTML.toLowerCase().includes('hobbiton'));
    record('real-day-to-map-hobbiton', mapVisible && /Hobbiton/i.test(body) && htmlHasHobbiton, { clickedText: action.txt, mapVisible, htmlHasHobbiton });
  } catch (e) { record('real-day-to-map-hobbiton', false, {}, String(e)); }
  await ctx.close();
}

// Road segment -> map clicks.
for (const n of ['01','05','09','13']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const id = `real-route-segment-${n}-to-map`;
  try {
    await page.goto(BASE + '/visual-review/pages/desktop-route-satellite', { timeout: 60000 }); await ready(page);
    const card = page.locator(`#road-segment-${n}`).first();
    await card.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => scrollY);
    const btn = card.getByText(/הצגה במפה/, { exact: false }).first();
    if (!(await btn.isVisible().catch(() => false))) throw new Error('Show-on-map action not visible');
    await btn.click(); await page.waitForTimeout(1000);
    const mapVisible = await page.locator('.atlas-route-layout').first().isVisible().catch(() => false);
    const after = await page.evaluate(() => scrollY);
    const html = await page.locator('html').evaluate(el => el.outerHTML);
    const selectedMention = html.includes(`road-segment-${n}`);
    record(id, mapVisible && after < before && selectedMention, { beforeScrollY: before, afterScrollY: after, mapVisible, selectedMention });
  } catch (e) { record(id, false, {}, String(e)); }
  await ctx.close();
}

// Mobile cross-links.
for (const [id, kind] of [['real-mobile-day-to-booking-hobbiton','booking'], ['real-mobile-day-to-map-hobbiton','map']]) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  try {
    await page.goto(BASE + '/visual-review/pages/mobile-day-06-command', { timeout: 60000 }); await ready(page);
    const action = kind === 'booking'
      ? await findInteractiveInContext(page, /פרטי.*הזמנה|הזמנה/, 'Hobbiton')
      : await findInteractiveInContext(page, /^במפה$|הצגה במפה/, 'Hobbiton');
    if (!action) throw new Error(`Could not find mobile ${kind} action`);
    await action.el.click(); await page.waitForTimeout(1000);
    const body = await page.locator('body').innerText();
    const success = kind === 'booking'
      ? (await page.locator('[data-booking-id="hobbiton"]').first().isVisible().catch(() => false)) && /Hobbiton/i.test(body)
      : (await page.locator('.atlas-route-layout').first().isVisible().catch(() => false)) && /Hobbiton/i.test(body);
    record(id, success, { clickedText: action.txt });
  } catch (e) { record(id, false, {}, String(e)); }
  await ctx.close();
}

await browser.close();
out.summary = { total: out.tests.length, passed: out.tests.filter(t=>t.success).length, failed: out.tests.filter(t=>!t.success).length };
await fs.writeFile('real-e2e-results.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.summary));

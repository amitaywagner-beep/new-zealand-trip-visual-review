import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.VISUAL_REVIEW_BASE_URL || 'https://amitai-new-zealand-v39-ci.amitaywagner.chatgpt.site';
const EMAIL = process.env.DOCUMENT_E2E_EMAIL || '';
const INVITE = process.env.DOCUMENT_E2E_INVITE_CODE || '';
const STORAGE_STATE_PATH = process.env.PLAYWRIGHT_STORAGE_STATE_PATH || '';
const outDir = path.resolve('document-ci-e2e-artifacts');
await fs.mkdir(outDir, { recursive: true });

const now = Date.now();
const testAName = `CI association test ${now}.pdf`;
const testBName = `CI mobile upload ${now}.pdf`;
const pdfPath = path.join(outDir, 'sample-test-document.pdf');

// Tiny valid one-page PDF generated locally; contains no real user data.
const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 59>>stream\nBT /F1 18 Tf 36 72 Td (sample-test-document.pdf) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000241 00000 n \n0000000349 00000 n \ntrailer<</Size 6/Root 1 0 R>>\nstartxref\n419\n%%EOF\n`;
await fs.writeFile(pdfPath, pdf, 'binary');

const results = [];
let browser;

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeText(s, max = 900) {
  let out = String(s ?? '');
  if (EMAIL) out = out.replace(new RegExp(escapeRegex(EMAIL), 'gi'), '[email]');
  if (INVITE) out = out.replace(new RegExp(escapeRegex(INVITE), 'g'), '[invite]');
  return out.slice(0, max);
}

async function record(id, fn) {
  const startedAt = new Date().toISOString();
  try {
    const details = await fn();
    results.push({ id, success: true, startedAt, finishedAt: new Date().toISOString(), details });
  } catch (e) {
    results.push({ id, success: false, startedAt, finishedAt: new Date().toISOString(), error: safeText(e?.stack || e) });
  }
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true }).catch(() => {});
}

async function controlInventory(page) {
  return await page.evaluate(() => [...document.querySelectorAll('input,button,select,textarea,a,[role="button"]')].filter(el => {
    const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
  }).slice(0, 150).map(el => ({
    tag: el.tagName,
    type: el.getAttribute('type'),
    name: el.getAttribute('name'),
    text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 100),
  })));
}

async function fillFirst(page, locators, value) {
  if (!value) return false;
  for (const loc of locators) {
    const el = page.locator(loc).first();
    if (await el.count() && await el.isVisible().catch(() => false)) {
      await el.fill(value); return true;
    }
  }
  return false;
}

async function clickFirst(page, patterns) {
  for (const re of patterns) {
    const byRole = page.getByRole('button', { name: re }).first();
    if (await byRole.count() && await byRole.isVisible().catch(() => false)) { await byRole.click(); return true; }
    const text = page.getByText(re).first();
    if (await text.count() && await text.isVisible().catch(() => false)) { await text.click(); return true; }
  }
  return false;
}

async function authenticate(page) {
  await page.goto(`${BASE}/#bookings`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);

  // A valid ChatGPT storage state may already be sufficient to expose the vault.
  if (await page.locator('.documents-hub').count() && await page.getByRole('button', { name: /העלאת מסמך/i }).count()) {
    return { chatgptSessionAccepted: true, inviteRequired: false };
  }

  // If the isolated v39 build still asks for the site invite, enter only the fields it actually exposes.
  await clickFirst(page, [/כניסה/i, /התחברות/i, /גישה/i, /כספת/i, /אימות/i]).catch(() => false);
  await page.waitForTimeout(600);

  const emailFilled = await fillFirst(page, [
    'input[name="email"]', 'input[type="email"]', 'input[autocomplete="email"]', 'input[placeholder*="מייל"]', 'input[placeholder*="email" i]'
  ], EMAIL);
  const inviteFilled = await fillFirst(page, [
    'input[name="inviteCode"]', 'input[name="invite_code"]', 'input[name*="invite" i]', 'input[name*="code" i]', 'input[placeholder*="קוד"]', 'input[placeholder*="code" i]'
  ], INVITE);

  // When ChatGPT auth identifies the account, an email field may intentionally not exist.
  if (!inviteFilled && !(await page.locator('.documents-hub').count())) {
    await screenshot(page, 'invite-field-not-found');
    throw new Error(`Invite field not found after loading authenticated ChatGPT storage state. emailFieldPresent=${emailFilled}; controls=${JSON.stringify(await controlInventory(page))}`);
  }

  if (inviteFilled) {
    const submitted = await clickFirst(page, [/כניסה/i, /המשך/i, /אימות/i, /פתיחת/i, /גישה/i, /התחבר/i]);
    if (!submitted) {
      const inviteInput = page.locator('input[name="inviteCode"],input[name="invite_code"],input[name*="invite" i],input[name*="code" i]').first();
      const form = page.locator('form').filter({ has: inviteInput }).first();
      if (await form.count()) await form.evaluate(f => f.requestSubmit()); else throw new Error('Could not submit invite form');
    }
  }

  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/#bookings`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1200);
  if (!await page.locator('.documents-hub').count() || !await page.getByRole('button', { name: /העלאת מסמך/i }).count()) {
    await screenshot(page, 'auth-failed');
    throw new Error(`Authenticated ChatGPT session + invite did not reach documents hub; controls=${JSON.stringify(await controlInventory(page))}`);
  }
  return { chatgptSessionAccepted: true, inviteRequired: inviteFilled, emailFieldPresent: emailFilled };
}

async function openUpload(page) {
  const hub = page.locator('.documents-hub').first();
  await hub.scrollIntoViewIfNeeded();
  const btn = page.getByRole('button', { name: /העלאת מסמך/i }).first();
  if (!await btn.count()) throw new Error('Upload button not found');
  await btn.click();
  const form = page.locator('.document-upload-form').first();
  await form.waitFor({ state: 'visible', timeout: 10000 });
  return form;
}

async function chooseAssociation(form, type, values) {
  const wanted = Array.isArray(values) ? values : [values];
  const typeRegex = type === 'day' ? /day|יום/i : type === 'booking' ? /booking|הזמנה/i : /poi|נקוד|אתר|אטרק/i;

  for (const sel of await form.locator('select').all()) {
    const name = `${await sel.getAttribute('name') || ''} ${await sel.getAttribute('aria-label') || ''}`;
    if (!typeRegex.test(name)) continue;
    for (const val of wanted) {
      const options = await sel.locator('option').evaluateAll(os => os.map(o => ({ value: o.value, text: o.textContent || '' })));
      const match = options.find(o => o.value === val || o.text.toLowerCase().includes(val.toLowerCase()) || (type === 'day' && /יום\s*6/.test(o.text)) || ((type === 'booking' || type === 'poi') && /hobbiton|הוביטון/i.test(o.text)));
      if (match) { await sel.selectOption(match.value); return true; }
    }
  }

  const inputs = await form.locator('input').all();
  for (const input of inputs) {
    const name = `${await input.getAttribute('name') || ''} ${await input.getAttribute('aria-label') || ''}`;
    if (!typeRegex.test(name)) continue;
    const itype = (await input.getAttribute('type') || 'text').toLowerCase();
    if (itype === 'text' || itype === 'search' || !itype) { await input.fill(wanted[0]); return true; }
    if (itype === 'checkbox' || itype === 'radio') {
      const value = await input.getAttribute('value') || '';
      const id = await input.getAttribute('id');
      const label = id ? await form.locator(`label[for="${id}"]`).textContent().catch(() => '') : '';
      if (wanted.some(v => value === v || `${value} ${label}`.toLowerCase().includes(v.toLowerCase())) || (type === 'day' && /יום\s*6/.test(label || '')) || ((type === 'booking' || type === 'poi') && /hobbiton|הוביטון/i.test(`${value} ${label}`))) {
        await input.check(); return true;
      }
    }
  }

  const candidates = form.getByRole('button', { name: typeRegex });
  if (await candidates.count()) {
    await candidates.first().click();
    await pageOrFormOption(form.page(), type, wanted);
    return true;
  }
  return false;
}

async function pageOrFormOption(page, type, wanted) {
  const patterns = type === 'day' ? [/day-06/i, /יום\s*6/i] : [/hobbiton/i, /הוביטון/i];
  for (const re of patterns) {
    const option = page.getByRole('option', { name: re }).first();
    if (await option.count() && await option.isVisible().catch(() => false)) { await option.click(); return; }
    const text = page.getByText(re).last();
    if (await text.count() && await text.isVisible().catch(() => false)) { await text.click(); return; }
  }
  throw new Error(`Association option not found for ${type}: ${wanted.join(',')}`);
}

async function submitUpload(page, displayName, { requireAssociations }) {
  const form = await openUpload(page);
  await form.locator('input[name="file"]').setInputFiles(pdfPath);
  await form.locator('input[name="displayName"]').fill(displayName);

  const associationResults = {};
  if (requireAssociations) {
    associationResults.day = await chooseAssociation(form, 'day', ['day-06']);
    associationResults.booking = await chooseAssociation(form, 'booking', ['hobbiton']);
    associationResults.poi = await chooseAssociation(form, 'poi', ['hobbiton']);
    if (!associationResults.day || !associationResults.booking || !associationResults.poi) {
      await screenshot(page, `association-controls-${displayName.replace(/\W+/g,'-')}`);
      throw new Error(`Could not set all associations: ${JSON.stringify(associationResults)}; controls=${JSON.stringify(await controlInventory(page))}`);
    }
  }

  const category = form.locator('select[name="category"]').first();
  if (await category.count()) {
    const options = await category.locator('option').evaluateAll(os => os.map(o => ({ value:o.value,text:o.textContent||'' })));
    const attraction = options.find(o => /attraction|אטרק/i.test(`${o.value} ${o.text}`));
    if (attraction) await category.selectOption(attraction.value);
  }

  const submit = form.getByRole('button', { name: /העלא|שמירה|הוספ/i }).first();
  if (!await submit.count()) throw new Error('Upload submit button not found');
  await submit.click();
  await page.waitForTimeout(1000);

  const row = page.locator('.document-row[data-document-id]').filter({ hasText: displayName }).first();
  await row.waitFor({ state: 'visible', timeout: 20000 });
  const documentId = await row.getAttribute('data-document-id');
  if (!documentId) throw new Error('Uploaded row has no document id');
  return { documentId, associationResults };
}

async function verifyHub(page, displayName, expectedId) {
  await page.goto(`${BASE}/#bookings`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForTimeout(900);
  const row = page.locator('.documents-hub .document-row[data-document-id]').filter({ hasText: displayName }).first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  const id = await row.getAttribute('data-document-id');
  if (id !== expectedId) throw new Error(`Hub document id mismatch: ${id} != ${expectedId}`);
  return id;
}

async function verifyBooking(page, displayName, expectedId) {
  const card = page.locator('[data-booking-id="hobbiton"]').first();
  await card.scrollIntoViewIfNeeded();
  const doc = card.locator('.document-row[data-document-id]').filter({ hasText: displayName }).first();
  await doc.waitFor({ state: 'visible', timeout: 10000 });
  const id = await doc.getAttribute('data-document-id');
  if (id !== expectedId) throw new Error(`Booking document id mismatch: ${id} != ${expectedId}`);
  return id;
}

async function verifyDay(page, displayName, expectedId) {
  const daysNav = page.getByRole('button', { name: /^ימים$/ }).first();
  if (await daysNav.count()) await daysNav.click(); else {
    const daysLink = page.getByText(/^ימים$/).first(); if (await daysLink.count()) await daysLink.click(); else await page.goto(`${BASE}/#days`);
  }
  await page.waitForTimeout(700);

  // Select the opener from the smallest local container that belongs only to Day 6.
  // The previous broad `article,section,div` locator could match the whole days list,
  // causing `.first()` to open Day 1 while the assertion expected Day 6.
  const openers = page.locator('button,a,[role="button"]').filter({ hasText: /פתיחת היום/ });
  let day6Opener = null;
  const openerCount = await openers.count();
  for (let i = 0; i < openerCount; i++) {
    const opener = openers.nth(i);
    if (!await opener.isVisible().catch(() => false)) continue;
    const isDay6 = await opener.evaluate(el => {
      let node = el;
      for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
        const text = (node.innerText || '').replace(/\s+/g, ' ');
        const dayNumbers = [...text.matchAll(/יום\s*(\d{1,2})\b/g)].map(match => Number(match[1]));
        if (dayNumbers.includes(6) && dayNumbers.every(day => day === 6)) return true;
      }
      return false;
    }).catch(() => false);
    if (isDay6) { day6Opener = opener; break; }
  }

  if (!day6Opener) {
    await screenshot(page, 'day-6-opener-not-found');
    throw new Error(`Could not isolate the Day 6 opener from ${openerCount} visible day controls`);
  }

  const day6ResponsePromise = page.waitForResponse(response => {
    try {
      const url = new URL(response.url());
      return url.pathname === '/api/documents' && url.searchParams.get('dayId') === 'day-06' && response.status() < 500;
    } catch { return false; }
  }, { timeout: 10000 }).catch(() => null);

  await day6Opener.click();
  const day6Response = await day6ResponsePromise;
  if (!day6Response) {
    await screenshot(page, 'day-6-request-not-observed');
    throw new Error('Opening Day 6 did not issue GET /api/documents?dayId=day-06');
  }

  const scope = page.locator('.day-drawer').first();
  await scope.waitFor({ state: 'visible', timeout: 10000 });
  const doc = scope.locator('.document-row[data-document-id]').filter({ hasText: displayName }).first();
  await doc.waitFor({ state: 'visible', timeout: 10000 });
  const id = await doc.getAttribute('data-document-id');
  if (id !== expectedId) throw new Error(`Day document id mismatch: ${id} != ${expectedId}`);
  return id;
}

async function openDocument(page, displayName) {
  await page.goto(`${BASE}/#bookings`, { waitUntil:'domcontentloaded', timeout:60000 }); await page.waitForTimeout(700);
  const row = page.locator('.documents-hub .document-row[data-document-id]').filter({ hasText: displayName }).first();
  await row.waitFor({ state:'visible', timeout:10000 });
  const open = row.getByRole('button', { name:/פתיחה/i }).first();
  const openLink = row.getByRole('link', { name:/פתיחה/i }).first();
  const trigger = await open.count() ? open : openLink;
  if (!await trigger.count()) throw new Error('Open control not found');
  const popupPromise = page.waitForEvent('popup', { timeout:5000 }).catch(()=>null);
  const responsePromise = page.waitForResponse(r => /document|file|download|storage/i.test(r.url()) && r.status() < 500, { timeout:5000 }).catch(()=>null);
  await trigger.click();
  const popup = await popupPromise; const response = await responsePromise;
  if (popup) { await popup.waitForLoadState('domcontentloaded', { timeout:10000 }).catch(()=>{}); await popup.close().catch(()=>{}); return { method:'popup' }; }
  if (response) return { method:'response', status:response.status() };
  await page.waitForTimeout(700);
  if (await page.locator('iframe,embed,object,[role="dialog"]').count()) return { method:'inline-viewer' };
  throw new Error('Document open action produced no observable viewer/response');
}

async function deleteDocument(page, displayName) {
  await page.goto(`${BASE}/#bookings`, { waitUntil:'domcontentloaded', timeout:60000 }); await page.waitForTimeout(700);
  const row = page.locator('.documents-hub .document-row[data-document-id]').filter({ hasText: displayName }).first();
  if (!await row.count()) return { alreadyAbsent:true };
  let del = row.getByRole('button', { name:/מחיק/i }).first();
  if (!await del.count()) {
    const menu = row.getByRole('button', { name:/עוד|פעולות|אפשרויות|⋯|…/i }).first();
    if (await menu.count()) { await menu.click(); del = page.getByRole('button', { name:/מחיק/i }).last(); }
  }
  if (!await del.count()) throw new Error('Delete control not found');
  await del.click();
  const confirm = page.getByRole('button', { name:/מחיק|אישור|כן/i }).last();
  if (await confirm.count() && await confirm.isVisible().catch(()=>false)) await confirm.click();
  await page.waitForTimeout(800);
  await page.reload({ waitUntil:'domcontentloaded' }); await page.waitForTimeout(800);
  const remains = await page.locator('.document-row[data-document-id]').filter({ hasText:displayName }).count();
  if (remains) throw new Error('Document still present after delete and reload');
  return { deleted:true };
}

if (!EMAIL || !INVITE || !STORAGE_STATE_PATH) {
  results.push({ id:'configuration', success:false, error:'Required GitHub Actions secrets DOCUMENT_E2E_EMAIL, DOCUMENT_E2E_INVITE_CODE and/or PLAYWRIGHT_STORAGE_STATE_B64 are unavailable.' });
} else {
  browser = await chromium.launch({ headless:true });
  let authContext;
  try {
    authContext = await browser.newContext({ viewport:{width:1440,height:1000}, storageState: STORAGE_STATE_PATH });
  } catch (e) {
    results.push({ id:'configuration', success:false, error:`Could not load Playwright storage state: ${safeText(e?.message || e)}` });
  }

  if (authContext) {
    const authPage = await authContext.newPage();
    await record('authentication', async () => await authenticate(authPage));
    const authOkay = results.at(-1)?.success;
    let storageState;
    if (authOkay) storageState = await authContext.storageState();
    await authContext.close();

    if (authOkay) {
      await record('association-rendering', async () => {
        const ctx = await browser.newContext({ viewport:{width:1440,height:1000}, storageState });
        const page = await ctx.newPage();
        await page.goto(`${BASE}/#bookings`, { waitUntil:'domcontentloaded', timeout:60000 }); await page.waitForTimeout(700);
        let documentId;
        try {
          ({ documentId } = await submitUpload(page, testAName, { requireAssociations:true }));
          const hubId = await verifyHub(page, testAName, documentId);
          const bookingId = await verifyBooking(page, testAName, documentId);
          const dayId = await verifyDay(page, testAName, documentId);
          await screenshot(page, 'association-rendering-pass');
          return { documentId, idsConsistent:new Set([hubId,bookingId,dayId]).size===1, hub:true, booking:true, day:true };
        } finally {
          if (documentId) await deleteDocument(page, testAName).catch(async e => { await fs.writeFile(path.join(outDir,'association-cleanup-error.txt'), safeText(e?.stack||e)); });
          await ctx.close();
        }
      });

      await record('mobile-real-upload-390x844', async () => {
        const ctx = await browser.newContext({ viewport:{width:390,height:844}, hasTouch:true, storageState });
        const page = await ctx.newPage();
        await page.goto(`${BASE}/#bookings`, { waitUntil:'domcontentloaded', timeout:60000 }); await page.waitForTimeout(700);
        let documentId;
        try {
          ({ documentId } = await submitUpload(page, testBName, { requireAssociations:false }));
          await page.reload({ waitUntil:'domcontentloaded' }); await page.waitForTimeout(800);
          const row = page.locator('.documents-hub .document-row[data-document-id]').filter({ hasText:testBName }).first();
          await row.waitFor({ state:'visible', timeout:15000 });
          const persistedId = await row.getAttribute('data-document-id');
          if (persistedId !== documentId) throw new Error(`Mobile persistence id mismatch: ${persistedId} != ${documentId}`);
          const open = await openDocument(page, testBName);
          await screenshot(page, 'mobile-upload-pass');
          await deleteDocument(page, testBName);
          return { viewport:'390x844', touch:true, documentId, persisted:true, opened:open, deleted:true };
        } finally {
          if (documentId) await deleteDocument(page, testBName).catch(async e => { await fs.writeFile(path.join(outDir,'mobile-cleanup-error.txt'), safeText(e?.stack||e)); });
          await ctx.close();
        }
      });
    }
  }

  await browser.close();
}

const summary = { total:results.length, passed:results.filter(x=>x.success).length, failed:results.filter(x=>!x.success).length };
const output = { generatedAt:new Date().toISOString(), baseUrl:BASE, environment:'github-actions-playwright-chromium', viewportMobile:'390x844', testDataOnly:true, storageStateUsed:Boolean(STORAGE_STATE_PATH), results, summary };
await fs.writeFile('document-ci-e2e-results.json', JSON.stringify(output,null,2));
console.log(JSON.stringify(summary));
if (summary.failed) process.exitCode = 1;

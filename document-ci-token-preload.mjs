import { chromium } from 'playwright';

const ciToken = process.env.V39_CI_TEST_TOKEN || '';
const ciOrigin = 'https://amitai-new-zealand-v39-ci.amitaywagner.chatgpt.site';

if (!ciToken) {
  throw new Error('V39_CI_TEST_TOKEN is required');
}

const originalLaunch = chromium.launch.bind(chromium);

function summarizeDocumentPayload(payload, method) {
  const syntheticRe = /CI (association test|mobile upload) \d+\.pdf/;
  const keys = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? Object.keys(payload).slice(0, 20)
    : [];

  if (method === 'POST') {
    const json = JSON.stringify(payload ?? null);
    const documentObject = payload?.document && typeof payload.document === 'object' ? payload.document : null;
    return {
      shape: Array.isArray(payload) ? 'array' : typeof payload,
      keys,
      success: typeof payload?.success === 'boolean' ? payload.success : null,
      hasId: Boolean(payload?.id || payload?.documentId || documentObject?.id),
      syntheticNamePresent: syntheticRe.test(json),
      errorCode: typeof payload?.code === 'string' ? payload.code.slice(0, 80) : null,
    };
  }

  let docs = null;
  if (Array.isArray(payload)) docs = payload;
  else if (Array.isArray(payload?.documents)) docs = payload.documents;
  else if (Array.isArray(payload?.items)) docs = payload.items;
  else if (Array.isArray(payload?.data)) docs = payload.data;

  return {
    shape: Array.isArray(payload) ? 'array' : typeof payload,
    keys,
    documentArrayFound: Boolean(docs),
    total: docs ? docs.length : null,
    syntheticCount: docs ? docs.filter(item => syntheticRe.test(JSON.stringify(item))).length : null,
  };
}

chromium.launch = async (...args) => {
  const browser = await originalLaunch(...args);
  const originalNewContext = browser.newContext.bind(browser);

  return new Proxy(browser, {
    get(target, prop) {
      if (prop === 'newContext') {
        return async (options = {}) => {
          const context = await originalNewContext({
            ...options,
            serviceWorkers: 'block',
          });

          await context.route('**/*', async (route) => {
            const request = route.request();
            let url;
            try {
              url = new URL(request.url());
            } catch {
              return route.continue();
            }

            if (url.origin !== ciOrigin) {
              return route.continue();
            }

            return route.continue({
              headers: {
                ...request.headers(),
                'OAI-Sites-Authorization': `Bearer ${ciToken}`,
                'X-CI-Test-Token': ciToken,
              },
            });
          });

          const originalNewPage = context.newPage.bind(context);
          context.newPage = async (...pageArgs) => {
            const page = await originalNewPage(...pageArgs);
            let uploadRefreshScheduled = false;

            // Safe CI diagnostics only: method/status/path and sanitized payload shape.
            // Never print headers, query strings, response bodies, document names or token values.
            page.on('response', response => {
              try {
                const request = response.request();
                const url = new URL(response.url());
                if (url.origin !== ciOrigin) return;
                const method = request.method();
                if (method !== 'GET' || /document|upload|file|vault|api/i.test(url.pathname)) {
                  console.log(`CI_NET ${method} ${response.status()} ${url.pathname}`);
                }

                if (url.pathname === '/api/documents' && (method === 'GET' || method === 'POST')) {
                  void (async () => {
                    try {
                      const payload = await response.json();
                      console.log(`CI_API ${method} ${JSON.stringify(summarizeDocumentPayload(payload, method))}`);
                    } catch {
                      console.log(`CI_API ${method} {\"jsonReadable\":false}`);
                    }
                  })();
                }

                // The upload endpoint may persist successfully without immediately refreshing
                // the client-side list. Reload after a successful HTTP response so assertions
                // can read the server-side source of truth.
                if (
                  method === 'POST' &&
                  url.pathname === '/api/documents' &&
                  response.status() >= 200 &&
                  response.status() < 300 &&
                  !uploadRefreshScheduled
                ) {
                  uploadRefreshScheduled = true;
                  void (async () => {
                    await response.finished().catch(() => {});
                    await page.waitForTimeout(500).catch(() => {});
                    if (!page.isClosed()) {
                      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                      await page.waitForTimeout(1200).catch(() => {});
                    }
                    uploadRefreshScheduled = false;
                  })();
                }
              } catch {}
            });

            page.on('requestfailed', request => {
              try {
                const url = new URL(request.url());
                if (url.origin !== ciOrigin) return;
                console.log(`CI_NET_FAIL ${request.method()} ${url.pathname}`);
              } catch {}
            });

            page.on('console', msg => {
              const text = msg.text();
              if (text.startsWith('CI_DOM ') || text.startsWith('CI_FORM ')) {
                console.log(text);
              }
            });

            await page.addInitScript(() => {
              const seen = new Set();

              function reportSyntheticLocations() {
                const candidates = document.querySelectorAll('[data-document-id], .document-row, .day-drawer, .documents-hub, [data-booking-id]');
                for (const el of candidates) {
                  const text = el.textContent || '';
                  if (!/CI (association test|mobile upload) \d+\.pdf/.test(text)) continue;
                  const key = [
                    el.tagName,
                    el.className || '',
                    el.getAttribute('data-document-id') || '',
                    el.getAttribute('data-booking-id') || '',
                    Boolean(el.closest('.day-drawer')),
                    Boolean(el.closest('.documents-hub')),
                  ].join('|');
                  if (seen.has(key)) continue;
                  seen.add(key);
                  console.log('CI_DOM ' + JSON.stringify({
                    tag: el.tagName,
                    className: String(el.className || '').slice(0, 120),
                    hasDocumentId: Boolean(el.getAttribute('data-document-id')),
                    bookingId: el.getAttribute('data-booking-id') || null,
                    inDayDrawer: Boolean(el.closest('.day-drawer')),
                    inDocumentsHub: Boolean(el.closest('.documents-hub')),
                  }));
                }
              }

              const observer = new MutationObserver(() => setTimeout(reportSyntheticLocations, 0));
              observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
              window.addEventListener('DOMContentLoaded', reportSyntheticLocations);

              document.addEventListener('submit', event => {
                const form = event.target?.closest?.('.document-upload-form');
                if (!form) return;
                const invalidCount = form.querySelectorAll(':invalid').length;
                const fileInput = form.querySelector('input[type="file"]');
                const nameInput = form.querySelector('input[name="displayName"]');
                console.log('CI_FORM ' + JSON.stringify({
                  event: 'submit',
                  invalidCount,
                  hasFile: Boolean(fileInput?.files?.length),
                  hasDisplayName: Boolean(nameInput?.value),
                }));
              }, true);

              document.addEventListener('click', event => {
                const button = event.target?.closest?.('.document-upload-form button');
                if (!button) return;
                setTimeout(() => {
                  const form = document.querySelector('.document-upload-form');
                  console.log('CI_FORM ' + JSON.stringify({
                    event: 'post-click',
                    formStillVisible: Boolean(form),
                    invalidCount: form ? form.querySelectorAll(':invalid').length : 0,
                    documentRowCount: document.querySelectorAll('.document-row[data-document-id]').length,
                  }));
                }, 500);
              }, true);
            });

            const originalGoto = page.goto.bind(page);
            page.goto = async (...gotoArgs) => {
              const response = await originalGoto(...gotoArgs);
              await page.waitForTimeout(1200);
              return response;
            };
            return page;
          };

          return context;
        };
      }

      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
};

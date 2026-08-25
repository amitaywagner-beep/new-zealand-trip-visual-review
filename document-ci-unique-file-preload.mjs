import './document-ci-token-preload.mjs';
import { chromium } from 'playwright';

// v39 correctly deduplicates identical file bytes. The main E2E intentionally
// reuses one tiny local PDF fixture, so make each browser-selected synthetic
// fixture unique without touching the application or any real user data.
//
// This layer also removes CI-only timing races and emits only sanitized
// association diagnostics for the synthetic test document.
const previousLaunch = chromium.launch.bind(chromium);

chromium.launch = async (...args) => {
  const browser = await previousLaunch(...args);
  const previousNewContext = browser.newContext.bind(browser);

  return new Proxy(browser, {
    get(target, prop) {
      if (prop === 'newContext') {
        return async (options = {}) => {
          const context = await previousNewContext(options);
          const previousNewPage = context.newPage.bind(context);

          context.newPage = async (...pageArgs) => {
            const page = await previousNewPage(...pageArgs);

            // The app uses a native confirmation dialog before destructive delete.
            // Playwright dismisses dialogs by default when no listener exists, so
            // explicitly accept only confirmation dialogs in this synthetic E2E.
            page.on('dialog', async dialog => {
              try {
                if (dialog.type() === 'confirm') await dialog.accept();
                else await dialog.dismiss();
              } catch {}
            });

            await page.addInitScript(() => {
              document.addEventListener('change', event => {
                const input = event.target;
                if (!(input instanceof HTMLInputElement)) return;
                if (input.type !== 'file' || !input.closest('.document-upload-form')) return;
                if (!input.files?.length) return;

                const original = input.files[0];
                const nonce = `\n% CI-UNIQUE-${Date.now()}-${crypto.randomUUID()}\n`;
                const uniqueFile = new File(
                  [original, nonce],
                  original.name,
                  {
                    type: original.type || 'application/pdf',
                    lastModified: Date.now(),
                  },
                );
                const transfer = new DataTransfer();
                transfer.items.add(uniqueFile);
                input.files = transfer.files;
                console.log('CI_FORM ' + JSON.stringify({ event: 'fixture-uniquified', sizeChanged: uniqueFile.size !== original.size }));
              }, true);
            });

            // Report only whether the synthetic upload response persisted the
            // expected public association IDs. Never print document/user data.
            page.on('response', response => {
              void (async () => {
                try {
                  const request = response.request();
                  const url = new URL(response.url());
                  if (request.method() !== 'POST' || url.pathname !== '/api/documents') return;
                  const payload = await response.json();
                  const documentObject = payload?.document && typeof payload.document === 'object' ? payload.document : null;
                  const associations = payload?.associations ?? documentObject?.associations ?? null;
                  const serialized = JSON.stringify(associations ?? null);
                  console.log('CI_ASSOC ' + JSON.stringify({
                    hasDay06: /day-06/i.test(serialized),
                    hasHobbiton: /hobbiton/i.test(serialized),
                    associationsPresent: associations != null,
                  }));
                } catch {}
              })();
            });

            // The underlying auth layer already wraps goto. Add one final CI-only
            // readiness gate so the test never probes for the upload button before
            // the authenticated document hub has hydrated. If the inline viewer is
            // open, close it before returning to #bookings so it cannot intercept
            // the cleanup/delete click.
            const previousGoto = page.goto.bind(page);
            page.goto = async (...gotoArgs) => {
              const target = String(gotoArgs[0] || '');
              if (target.includes('#bookings')) {
                const viewer = page.locator('.document-viewer-shell,[role="dialog"]').first();
                if (await viewer.count() && await viewer.isVisible().catch(() => false)) {
                  const closeButton = viewer.getByRole('button', { name: /סגירה|סגור|close|×|✕/i }).first();
                  if (await closeButton.count() && await closeButton.isVisible().catch(() => false)) {
                    await closeButton.click().catch(() => {});
                  } else {
                    await page.keyboard.press('Escape').catch(() => {});
                  }
                  await viewer.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
                }
              }

              const response = await previousGoto(...gotoArgs);
              if (target.includes('#bookings')) {
                await page.locator('.documents-hub').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
                await page.getByRole('button', { name: /העלאת מסמך/i }).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
              }
              return response;
            };

            // Serialize reloads. The app/auth layer may refresh after POST while
            // the main E2E also requests a persistence reload; two simultaneous
            // navigations cause Chromium ERR_ABORTED even though the app is fine.
            const previousReload = page.reload.bind(page);
            let reloadInFlight = null;
            page.reload = async (...reloadArgs) => {
              if (reloadInFlight) return reloadInFlight;
              reloadInFlight = (async () => {
                try {
                  const response = await previousReload(...reloadArgs);
                  await page.waitForTimeout(500).catch(() => {});
                  return response;
                } finally {
                  reloadInFlight = null;
                }
              })();
              return reloadInFlight;
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

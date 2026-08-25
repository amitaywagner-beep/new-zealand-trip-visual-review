import './document-ci-token-preload.mjs';
import { chromium } from 'playwright';

// v39 correctly deduplicates identical file bytes. The main E2E intentionally
// reuses one tiny local PDF fixture, so make each browser-selected synthetic
// fixture unique without touching the application or any real user data.
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

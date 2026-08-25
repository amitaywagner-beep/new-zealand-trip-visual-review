import { chromium } from 'playwright';

const ciToken = process.env.V39_CI_TEST_TOKEN || '';
const ciOrigin = 'https://amitai-new-zealand-v39-ci.amitaywagner.chatgpt.site';

if (!ciToken) {
  throw new Error('V39_CI_TEST_TOKEN is required');
}

const originalLaunch = chromium.launch.bind(chromium);

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

          // v39 resolves CI auth server-side and then hydrates the document controls.
          // Give that UI a little time after navigation in every fresh context.
          const originalNewPage = context.newPage.bind(context);
          context.newPage = async (...pageArgs) => {
            const page = await originalNewPage(...pageArgs);
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

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
          // BrowserContext routing does not reliably intercept requests handled by
          // Service Workers. Block them in this isolated CI run so every request
          // to v39-ci passes through the scoped route below.
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
          return context;
        };
      }

      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
};

import { expect, test } from "@playwright/test";

/**
 * Offline-first, against the built app.
 *
 * The regression these cover is specific and was live: a service worker does
 * not control the page that registered it, so on a **first** visit the
 * content-hashed bundle is fetched straight from the network, never passes
 * through the fetch handler, and never lands in the cache. The document came
 * back from cache on the next load with no script to run — a blank page. It
 * only worked after a second online visit, which is not what "offline-first"
 * promises to someone who installs the app and gets on a plane.
 *
 * So the assertion that matters is *one* online visit, then offline.
 */
test("the app renders offline after a single online visit", async ({ page, context }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The install handler precaches the bundle; give it a moment to finish.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const cache = await caches.open("heimdall-v1");
          return (await cache.keys()).some(r => /\/assets\/index-.*\.js$/.test(new URL(r.url).pathname));
        }),
      { timeout: 30_000, message: "the bundle should be precached on the first visit" },
    )
    .toBe(true);

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });

  // Rendered, not merely served: a cached document with no bundle is a blank
  // page, and that is exactly the failure this guards.
  await expect(page.locator("body")).not.toBeEmpty();
  await expect(page.getByText("Clusters").first()).toBeVisible();
});

test("the shell answers a deep link offline", async ({ page, context }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(2000);
  await context.setOffline(true);

  // A route the cache has never seen: the navigation falls back to the app
  // shell, and the client router takes it from there.
  await page.goto("/some-cluster/pods", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).not.toBeEmpty();
});

// Accessibility audit: loads the app in headless Chromium and runs axe-core
// (WCAG 2.0/2.1 A + AA) against it, reporting violations by impact.
// Usage: node scripts/a11y.mjs [url]   (defaults to http://localhost:5199)
//
// Starts its own dev server unless one is already listening, and stops it again
// on the way out. It used to assume a server was already up, which made it pass
// or fail depending on what else the developer happened to be running — and made
// it unusable from the release gate, which is exactly where it matters.
//
// Each theme gets its own browser context, seeded with the app's own stored
// theme choice. `emulateMedia({ colorScheme })` is not enough on its own: the
// app's default choice is "dark", not "system", so emulating light left it dark
// and this script audited the dark theme twice while labelling one pass
// "[light]". assertTheme below makes that failure loud rather than silent.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const url = process.argv[2] || "http://localhost:5199";
const apiPort = process.env.HEIMDALL_API_PORT || "3012";

async function reachable() {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

let server;
if (!(await reachable())) {
  process.stdout.write(`starting dev server for ${url}\n`);
  // The dev runner directly, not `npm run dev`. Going through npm means
  // spawning npm.cmd on Windows, which needs shell:true, which is deprecated
  // for argument passing (DEP0190) — and spawning a .cmd without it fails
  // outright with EINVAL. Running the script under this same node avoids the
  // wrapper, the shell, and the platform branch.
  //
  // Its own API port, so this can never contend with the e2e runner's dev
  // server (3011). The two run back to back in the release gate, and sharing a
  // port made whichever came second fail with EADDRINUSE.
  server = spawn(process.execPath, [resolve(import.meta.dirname, "dev-spa.mjs")], {
    stdio: "ignore",
    env: { ...process.env, HEIMDALL_API_PORT: apiPort, HEIMDALL_API_TARGET: `http://127.0.0.1:${apiPort}` },
  });
  const deadline = Date.now() + 90_000;
  while (!(await reachable())) {
    if (Date.now() > deadline) {
      server.kill();
      throw new Error(`dev server did not come up at ${url} within 90s`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}
const stopServer = () => {
  if (!server) return;
  // The npm wrapper spawns the real server as a child, so kill the tree — and
  // synchronously, because this runs from an `exit` handler and `process.exit`
  // does not wait for anything asynchronous started inside one. An async kill
  // here leaves the port held and the next run fails to bind.
  if (process.platform === "win32")
    spawnSync("taskkill", ["/pid", String(server.pid), "/f", "/t"], { stdio: "ignore" });
  else server.kill("SIGTERM");
  server = undefined;
};
process.on("exit", stopServer);
const axeSource = readFileSync(resolve(import.meta.dirname, "../node_modules/axe-core/axe.min.js"), "utf8");

const browser = await chromium.launch();
const results = [];

/** Fail loudly if the page is not actually in the theme we asked for — a silent
 *  mismatch turns a whole half of this sweep into a duplicate of the other. */
async function assertTheme(page, theme) {
  await page
    .waitForFunction(t => document.documentElement.dataset.theme === t, theme, { timeout: 15_000 })
    .catch(() => {
      throw new Error(`the app did not switch to the ${theme} theme; this sweep would have audited the wrong one`);
    });
}

/** Wait for the page to settle instead of sleeping a fixed number of
 *  milliseconds. The fixed waits this replaces were tuned on an idle machine
 *  and audited half-rendered pages under load — an intermittent gate failure
 *  that reported violations which did not exist. */
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function audit(page, theme, label, prepare) {
  if (prepare) await prepare();
  await settle(page);
  await page.evaluate(axeSource);
  const r = await page.evaluate(
    async () => await axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }),
  );
  results.push({ label: `${label} [${theme}]`, violations: r.violations });
}

// Audit in BOTH themes — contrast bugs (dark text on a dark sidebar, or the
// inverse) only show in one of them.
for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
  // The app reads its stored choice before first paint, so seed it before load
  // rather than toggling afterwards and re-auditing a transitional page.
  await context.addInitScript(t => localStorage.setItem("hd-theme", t), theme);
  const page = await context.newPage();

  await page.goto(url, { waitUntil: "networkidle" }).catch(() => page.goto(url));
  await assertTheme(page, theme);

  await audit(page, theme, "Catalog / landing");
  await audit(page, theme, "Preferences", async () => {
    await page.evaluate(() => window.dispatchEvent(new Event("heimdall:open-preferences")));
  });

  // Dense live surfaces (resource table + detail drawer) need a connected
  // cluster. Best-effort: seed the companion prefs and drive through
  // docker-desktop; if it can't connect, skip these rather than fail the run.
  try {
    await page.keyboard.press("Escape").catch(() => {});
    await page.evaluate(() =>
      localStorage.setItem(
        "heimdall.preferences",
        JSON.stringify({ companionUrl: "http://127.0.0.1:38431", companionToken: "heimdall-dev" }),
      ),
    );
    await page.reload({ waitUntil: "networkidle" }).catch(() => {});
    await assertTheme(page, theme);
    await page.getByText("docker-desktop").first().waitFor({ timeout: 15_000 });
    await page.locator("tbody tr", { hasText: "docker-desktop" }).first().click();
    await page.getByText("Pods", { exact: true }).first().waitFor({ timeout: 15_000 });
    await page.getByText("Pods", { exact: true }).first().click();
    await page.locator("tbody tr").first().waitFor({ timeout: 20_000 });
    await audit(page, theme, "Cluster / Pods list");
    const row = page.locator("tbody tr").first();
    if (await row.count()) {
      await row.click();
      // The drawer's tabs, by role — the only stable handle on it. Its classes
      // are CSS-module hashes, and Blueprint's own are off-limits by convention.
      await page.getByRole("tab").first().waitFor({ timeout: 15_000 });
      await audit(page, theme, "Detail drawer");
    }
  } catch (e) {
    process.stdout.write(`\n(cluster surfaces skipped [${theme}] — ${String(e.message).split("\n")[0]})\n`);
  }

  await context.close();
}

await browser.close();

let total = 0;
for (const { label, violations } of results) {
  process.stdout.write(`\n=== ${label} ===\n`);
  if (violations.length === 0) {
    process.stdout.write("  ✓ no violations\n");
    continue;
  }
  for (const v of violations) {
    total += v.nodes.length;
    process.stdout.write(`  ✗ [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} node(s))\n`);
    for (const n of v.nodes.slice(0, 3)) {
      // Contrast failures are only actionable with the numbers axe measured —
      // the composited colours, not the ones in the stylesheet.
      const d = n.any?.[0]?.data;
      const measured = d?.contrastRatio
        ? `  ${d.contrastRatio}:1 (needs ${d.expectedContrastRatio}) — ${d.fgColor} on ${d.bgColor}`
        : "";
      process.stdout.write(`      ↳ ${n.target.join(" ")}${measured}\n`);
    }
  }
}
process.stdout.write(
  `\n${total === 0 ? "✓ PASS — no WCAG A/AA violations" : `✗ ${total} violating node(s) across surfaces`}\n`,
);
process.exit(total === 0 ? 0 : 1);

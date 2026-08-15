import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { NAV_TREE } from "../../app/ui/nav-tree";
import { profileFromKubeconfig } from "./cluster-profile.mjs";

// These drive the shipped SPA (`app/ui`, entered from index.html). They used to
// drive `app/components` through a `#lens-views` iframe, which Vite never built
// — no rollupOptions.input names legacy.html — so every one of them sat waiting
// 120s for an iframe that could not appear. They timed out rather than failing,
// which is why the suite looked slow instead of broken.

const here = dirname(fileURLToPath(import.meta.url));
const kubeconfig =
  process.env.HEIMDALL_E2E_KUBECONFIG || process.env.KUBECONFIG || resolve(here, "../../.e2e/kubeconfig.yaml");
const companionUrl = process.env.HEIMDALL_COMPANION_URL || "http://127.0.0.1:38431";
const companionToken = process.env.HEIMDALL_COMPANION_TOKEN || "";
const profile = profileFromKubeconfig(kubeconfig);

/** The router keys on the cluster's *name*, not its id — see app/ui/router.ts. */
const pageUrl = (page: string) => `/${encodeURIComponent(profile.name)}/${page}`;

/** Every nav page, groups flattened. Read from the nav tree rather than copied,
 *  so a page added to the sidebar is covered by the crash walk without an edit
 *  here — the old hand-maintained list had drifted from the app it named. */
const ALL_PAGES = NAV_TREE.flatMap(node => (node.children ? node.children.map(child => child.id) : [node.id]));

test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    ({ profile, companionUrl, companionToken }) => {
      // Profiles are sessionStorage (app/lib/kubernetes.ts); preferences are localStorage.
      sessionStorage.setItem("heimdall.cluster-profiles", JSON.stringify([profile]));
      sessionStorage.setItem("heimdall.cluster-profile", JSON.stringify(profile));
      localStorage.setItem("heimdall.preferences", JSON.stringify({ companionUrl, companionToken }));
    },
    { profile, companionUrl, companionToken },
  );
});

/** The sidebar's `<nav>`, addressed by its accessible name — the "shell is up"
 *  signal. Named rather than bare: the header grew a breadcrumb, which is also a
 *  navigation landmark, so `getByRole("navigation")` alone matches two. The
 *  cluster *name* is not usable either — it appears on the rail tile, its
 *  settings badge and the sidebar header alike. */
const shell = (page: Page) => page.getByRole("navigation", { name: "Cluster resources" });

async function open(page: Page, id: string): Promise<void> {
  await page.goto(pageUrl(id));
  await expect(shell(page)).toBeVisible({ timeout: 120_000 });
}

test("lists pods from the cluster", async ({ page }) => {
  await open(page, "pods");
  await expect(page.getByRole("cell", { name: /coredns/ }).first()).toBeVisible({ timeout: 90_000 });
});

test("shows namespaces and nodes", async ({ page }) => {
  await open(page, "namespaces");
  await expect(page.getByRole("cell", { name: "kube-system", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("cell", { name: "default", exact: true })).toBeVisible();

  await open(page, "nodes");
  await expect(page.getByRole("cell", { name: /sim-control-plane|^\S+$/ }).first()).toBeVisible({ timeout: 60_000 });
});

test("opens a detail drawer with live data", async ({ page }) => {
  await open(page, "pods");

  // Whatever pod the cluster actually has, rather than a fixture name. This
  // spec runs twice: against the in-memory simulator, which seeds "coredns-abc",
  // and against a real k3d cluster, whose coredns pod carries a generated suffix
  // like "coredns-576bfc4dc7-kd5dp". The hardcoded name could only ever match
  // the first, so the k3d job had been failing on this test alone — the two
  // beside it survived only because they match on a regex. The claim being made
  // here is "clicking a row opens the drawer for that row", which does not need
  // to know the name in advance.
  const firstRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: /\S/ }) })
    .nth(1);
  await firstRow.waitFor({ state: "visible", timeout: 90_000 });
  const podName = (await firstRow.getByRole("cell").nth(2).innerText()).trim();
  expect(podName, "the first pod row should carry a name").not.toEqual("");

  await firstRow.click();

  // The drawer is a Blueprint <Drawer>, which carries no dialog role, so it is
  // identified by the tab strip only it renders.
  await expect(page.getByRole("tab", { name: "Details" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(podName).first()).toBeVisible();
});

test("the browser's Back button returns to the previous page", async ({ page }) => {
  // The URL *is* the navigation state (app/ui/router.ts). This is the guarantee
  // that replaced the hand-rolled arrows in the header, so it is worth a test.
  await open(page, "pods");
  await open(page, "namespaces");
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${encodeURIComponent(profile.name)}/pods$`));
});

test("renders every nav page without crashing", async ({ page }) => {
  // ~40 navigations in one test, which took most of the default 180s budget and
  // tipped over it whenever the machine was busy — it runs last in an eight-job
  // gate, straight after the accessibility sweep has had two browsers open. It
  // failed twice that way, at a different page each time, and passed both times
  // when run alone. A test whose runtime sits against its own timeout reports
  // the load on the machine, not the state of the code.
  test.setTimeout(600_000);

  // Guards the class of bug where a view assumes a field the API may omit and
  // takes the whole tree down with it.
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(`${error.name}: ${error.message}`));

  await open(page, ALL_PAGES[0]);
  for (const id of ALL_PAGES) {
    // `domcontentloaded`, not the default `load`: the check below is that the
    // shell survived the render, which does not need every subresource settled.
    // Waiting for `load` made each step hostage to whatever the page fetches.
    await page.goto(pageUrl(id), { waitUntil: "domcontentloaded" });
    // The sidebar surviving the navigation is the liveness check: a thrown
    // render takes the React tree with it.
    await expect(shell(page), `sidebar gone after navigating to ${id}`).toBeVisible({ timeout: 30_000 });
  }

  expect(errors, `page errors during the nav walk:\n${errors.join("\n")}`).toEqual([]);
});

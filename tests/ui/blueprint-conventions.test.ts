// Regression guards for the BlueprintJS v6 pitfalls documented in
// docs/design/blueprint-guide.md. These are static source checks (no DOM) so
// they run fast in the unit tier and fail loudly if a regression sneaks back in.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const UI_DIR = join(process.cwd(), "app", "ui");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const files = walk(UI_DIR);
const codeFiles = files.filter(f => f.endsWith(".tsx") || f.endsWith(".ts"));
const styles = files.filter(f => f.endsWith(".css"));
const read = (f: string) => readFileSync(f, "utf8");
/** Source with comments removed. A comment cannot paint anything, so a rule
 *  about what the stylesheet *does* must not fire on prose describing it — these
 *  checks failed three times in one sitting on comments that existed only to
 *  explain why the very thing being matched was avoided. */
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "");
const rel = (f: string) => f.slice(process.cwd().length + 1);

// §1 — the deprecated react-popper <Popover> export mis-positions to (0,0) under
// React 19. Only PopoverNext (floating-ui) is allowed.
test("no deprecated <Popover> import from @blueprintjs/core (use PopoverNext)", () => {
  for (const f of codeFiles) {
    const m = read(f).match(/import\s*\{([^}]*)\}\s*from\s*["']@blueprintjs\/core["']/s);
    if (!m) continue;
    const names = m[1].split(",").map(s =>
      s
        .trim()
        .split(/\s+as\s+/)[0]
        .trim(),
    );
    assert.ok(!names.includes("Popover"), `${rel(f)} imports the deprecated 'Popover'; use 'PopoverNext'.`);
  }
});

// §1 — every inline overlay requires an <OverlaysProvider> ancestor.
test("app root is wrapped in <OverlaysProvider>", () => {
  assert.ok(
    read(join(UI_DIR, "main.tsx")).includes("OverlaysProvider"),
    "main.tsx must wrap the app in <OverlaysProvider>.",
  );
});

// §7 — never hardcode bp6-* class strings; use the Classes constants. (The --bp-*
// CSS custom properties are tokens, not class names, and are allowed.)
test("no hardcoded Blueprint class names (use Classes constants)", () => {
  for (const f of [...codeFiles, ...styles]) {
    const bad = code(f).match(/(?<!-)\bbp[0-9]-[a-z]/g);
    assert.ok(
      !bad,
      `${rel(f)} hardcodes Blueprint class name(s): ${[...new Set(bad)].join(", ")}. Use Classes.* constants.`,
    );
  }
});

// §7 — use the Blueprint <H1>-<H6> components, not raw intrinsic headings.
test("no raw <h1>-<h6> intrinsic headings (use Blueprint <H*>)", () => {
  for (const f of codeFiles) {
    const bad = read(f).match(/<h[1-6][\s>/]/g);
    assert.ok(!bad, `${rel(f)} uses a raw ${[...new Set(bad)].join(", ")} heading; use Blueprint <H1>-<H6>.`);
  }
});

// §5 — token state suffixes are rest|hover|active|disabled only. These families
// do not exist and silently no-op.
test("CSS Modules reference only real --bp-* tokens", () => {
  for (const f of styles) {
    const bad = read(f).match(/--bp-text-color[\w-]*|--bp-[a-z-]*(?:hovered|selected|subtle)[\w-]*/g);
    assert.ok(!bad, `${rel(f)} references non-existent --bp token(s): ${[...new Set(bad)].join(", ")}.`);
  }
});

// §5 — Blueprint's --bp-typography-color-* family is a trap: 18 of its 21
// tokens are *fixed light-theme values* that do not
// change under the dark theme, so using one paints dark-on-dark. Two shipped as
// real WCAG failures here — `muted` (#5f6b7c) and `primary-rest` (#2d72d2, at
// 2.65:1 on the drawer) — and axe only caught the second once the panel it was
// on became visible. A third, `--bp-typography-color-default` with no state
// suffix, is not defined at all and silently did nothing.
//
// The only three that genuinely flip are default-rest/hover/active. Anything
// else needs an --hd-* token with an end for each theme (see --hd-text-muted and
// --hd-link in app/ui/theme.css).
test("no fixed-light --bp-typography-color-* tokens (only default-rest/hover/active flip)", () => {
  const allowed = /^--bp-typography-color-default-(rest|hover|active)$/;
  for (const f of styles) {
    const used = code(f).match(/--bp-typography-color-[a-z-]*/g);
    if (!used) continue;
    for (const token of new Set(used)) {
      assert.ok(
        allowed.test(token),
        `${rel(f)} uses ${token}, which does not flip for the dark theme (or is undefined). ` +
          `Use an --hd-* token with a value per theme.`,
      );
    }
  }
});

// §6 — xterm renders to a <canvas>, so its fontFamily must be a concrete family;
// a CSS variable (var(--…)) does not resolve there and renders garbled text.
test("xterm Terminal fontFamily is a concrete family, not a CSS variable", () => {
  for (const f of codeFiles) {
    const src = read(f);
    if (!src.includes("new Terminal(")) continue;
    const m = src.match(/fontFamily:\s*["'`]([^"'`]*)["'`]/);
    if (!m) continue;
    assert.ok(
      !m[1].includes("var(--"),
      `${rel(f)} passes a CSS var as xterm fontFamily; use a concrete monospace stack.`,
    );
  }
});

// §7 — boolean size/emphasis props on <Button>/<AnchorButton> were deprecated in
// Blueprint v6 (use size="small|large" / variant="minimal|outlined"). Tag still
// supports a `minimal` boolean, so it's intentionally excluded. The attr matcher
// allows `>` inside `{...}` handlers so arrow functions don't truncate it.
test("no deprecated boolean size/variant props on <Button>/<AnchorButton>", () => {
  const attr = /<(Button|AnchorButton)((?:\s+[a-zA-Z][\w-]*(?:=(?:"[^"]*"|'[^']*'|\{[^}]*\}))?)*)\s*\/?>/g;
  for (const f of codeFiles) {
    for (const m of read(f).matchAll(attr)) {
      const bare = m[2].split(/\s+/).filter(t => t && !t.includes("="));
      for (const prop of ["minimal", "small", "large"]) {
        assert.ok(
          !bare.includes(prop),
          `${rel(f)} uses deprecated boolean '${prop}' on <${m[1]}>; use size=/variant= instead.`,
        );
      }
    }
  }
});

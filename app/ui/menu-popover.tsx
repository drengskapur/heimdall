import { Classes, PopoverNext } from "@blueprintjs/core";
import type { ComponentProps } from "react";

/**
 * Every menu popover in the app, in the chrome treatment: dark chrome, and the
 * surfaces that open *over* it are white.
 *
 * Blueprint darkens a popover twice over, which is why one fix is not enough.
 * `inheritDarkTheme={false}` stops it copying `Classes.DARK` onto the popover
 * element — but that alone changes nothing visible, because the dark rules are
 * *descendant* selectors (`.dark .menu`, not `.menu.dark`) and applyTheme() puts
 * the class on <html> and <body>, while popovers portal into <body>. Every menu
 * still matched through its ancestors.
 *
 * Per docs/design/chrome-spec.md, the spec
 * does something this app does not: **<html> and <body> carry no class at all**,
 * and `Classes.DARK` is opted into per component — the sidebar has it, the document
 * does not. So its menus are white for free, by being light by default.
 *
 * Inverting Heimdall to match would turn every portalled overlay — drawer,
 * dialog, alert — white in the same stroke, and would fight index.html's
 * pre-paint script (which sets the class on <html> to avoid a background flash)
 * and Blueprint's `body { color }`. That is a bigger change than a menu and
 * wants its own decision, so the popover re-asserts the light surface instead.
 *
 * Every value below comes from the spec rather than being invented, so this
 * tracks Blueprint's real light theme instead of an approximation of it:
 *
 *   .menu            background #fff, color #1c2127, radius 4px, padding 4px
 *   .popover         shadow  0 0 0 1px rgba(17,20,24,.1)
 *                          + 0 20px 25px -5px rgba(0,0,0,.1)
 *                          + 0 10px 15px -3px rgba(0,0,0,.1)
 *   .menu-item       color inherit, radius 4px, padding 4px 8px
 *   .menu-item:hover background rgba(143,153,168,.15)
 *   .menu-divider    border-top 1px solid rgba(17,20,24,.15)
 *   intents          the palette's -2 shades (danger #ac2f33 — 6.6:1 on white,
 *                    where the dark theme's #fa999c was 2.1:1 and unreadable)
 *   arrow-fill       #fff  (the arrow is a separate SVG path, so the surface
 *                    rules miss it and the triangle stays dark otherwise)
 *
 * The arrow's *border* path already matches the spec's rgb(17,20,24), so only
 * the fill is touched. Blueprint exports no constant for those two paths; they
 * render border-then-fill, hence `path:last-of-type`.
 *
 * Selectors are composed from Blueprint's `Classes` constants because the
 * convention (tests/ui/blueprint-conventions.test.ts) is that `bp*-` strings
 * never appear in our source — building the sheet in TS is how a stylesheet can
 * honour that, since CSS cannot read the constants, and a class rename then
 * follows the constant instead of silently no-opping. The rules are injected
 * after Blueprint's stylesheet and match its dark rules on specificity, so the
 * cascade settles them without `!important`.
 */
const LIGHT = "hd-menu-popover-light";
const STYLE_ID = "hd-menu-popover-style";
const TEXT = "var(--bp-palette-dark-gray-1)";
const HOVER = "rgba(143, 153, 168, .15)";

const INTENTS: ReadonlyArray<readonly [string, string]> = [
  [Classes.INTENT_PRIMARY, "var(--bp-palette-blue-2)"],
  [Classes.INTENT_SUCCESS, "var(--bp-palette-green-2)"],
  [Classes.INTENT_WARNING, "var(--bp-palette-orange-2)"],
  [Classes.INTENT_DANGER, "var(--bp-palette-red-2)"],
];

function sheet(): string {
  const intentRules = INTENTS.map(
    ([cls, color]) => `
.${LIGHT} .${Classes.MENU_ITEM}.${cls},
.${LIGHT} .${Classes.MENU_ITEM}.${cls}:hover { color: ${color}; }`,
  ).join("");

  return `
.${LIGHT}.${Classes.POPOVER} > .${Classes.POPOVER_CONTENT},
.${LIGHT} .${Classes.MENU} { background: #fff; color: ${TEXT}; }

.${LIGHT}.${Classes.POPOVER} {
  border-radius: 4px;
  box-shadow: 0 0 0 1px rgba(17, 20, 24, .1),
              0 20px 25px -5px rgba(0, 0, 0, .1),
              0 10px 15px -3px rgba(0, 0, 0, .1);
}

.${LIGHT} .${Classes.POPOVER_ARROW} path:last-of-type { fill: #fff; }

.${LIGHT} .${Classes.MENU_ITEM},
.${LIGHT} .${Classes.MENU_ITEM} .${Classes.ICON} { color: inherit; }

.${LIGHT} .${Classes.MENU_ITEM}:hover { background-color: ${HOVER}; color: inherit; }

.${LIGHT} .${Classes.MENU_DIVIDER} { border-top-color: rgba(17, 20, 24, .15); }
${intentRules}
`.trim();
}

function ensureStyle(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = sheet();
  document.head.append(el);
}

export function MenuPopover(props: ComponentProps<typeof PopoverNext>) {
  ensureStyle();
  const { popoverClassName, ...rest } = props;
  return (
    <PopoverNext
      inheritDarkTheme={false}
      popoverClassName={popoverClassName ? `${LIGHT} ${popoverClassName}` : LIGHT}
      {...rest}
    />
  );
}

# BlueprintJS v6 usage guide (Heimdall)

> Source-grounded conventions from reading `@blueprintjs/core@6.18.0`.
> These are the rules the Heimdall UI follows; deviations caused real bugs (see §1).

## 1. Overlays — the important one

- **Never use the `Popover` export.** It is the **deprecated** react-popper class component and **mis-positions to the top-left (0,0) under React 19 / StrictMode** (it even logs `POPOVER_WARN_REACT19`). This caused our row-menu-in-the-corner bug. **Use `PopoverNext`** (built on `@floating-ui/react`, `autoUpdate`-pinned). `Tooltip`, `ContextMenu`, and `ContextMenuPopover` already delegate to `PopoverNext` internally, so they're safe.
- **Wrap the app root in `<OverlaysProvider>`.** `Overlay2` (under every Popover/Tooltip/Dialog/Drawer/ContextMenu) requires it; without it Blueprint `console.error`s and falls back to a legacy global stack. `showContextMenu` supplies its *own* provider, but inline overlays do not.
- **Row / context menus → `showContextMenu({ targetOffset, content, onClose })`.** The virtual target is `position: fixed`, so `targetOffset` must be **viewport coordinates = `clientX`/`clientY`** (NOT `pageX`/`pageY` — the docstring is misleading). Call `e.preventDefault()` + `e.stopPropagation()` in the handler. Caveat: it's a **global singleton** — only one such menu exists app-wide; a second call closes the first. That's fine for a single-open row menu; for concurrent independent menus use `<ContextMenu>` per element instead.
- **Tooltip + ContextMenu on one target:** keep `Tooltip` as the **direct** child of `ContextMenu`/`PopoverNext` (`<ContextMenu><Tooltip>…</Tooltip></ContextMenu>`). Blueprint auto-disables the tooltip while the menu is open via `TooltipProvider`. Don't interpose a wrapper element between them or the auto-disable breaks.
- Portalled overlays escape ancestor `overflow` clipping, but a CSS `transform`/`filter`/`contain` on the **target's** ancestor chain still skews `position:absolute` math — `PopoverNext`/`ContextMenuPopover` use fixed strategy to sidestep this.

## 2. Component prop APIs (v6)

- **Button / AnchorButton:** `variant="minimal" | "outlined" | "solid"` (default solid) + `size="small" | "medium" | "large"` (default medium). The boolean **`small`/`large`/`minimal`/`outlined` props are deprecated** (still work) — use `variant`/`size`. `icon` + `endIcon` (`rightIcon` is deprecated).
- **Tag:** `minimal`, `intent`, `round`, `endIcon` are all current. `large` deprecated → `size` (Tags have no `"small"`).
- **MenuItem:** `icon`, `intent`, `text` (required), `shouldDismissPopover` (default true), `roleStructure`.
- **Drawer / DrawerSize:** `DrawerSize.SMALL="360px"` / `STANDARD="50%"` / `LARGE="90%"`; `size`, `position` (default `"right"`), `isOpen` (required), `title`, `onClose`. All current.
- **Alert:** `isOpen` (required), `intent`, `icon`, `confirmButtonText`, `cancelButtonText`, `loading`, `onConfirm`, `onCancel`. All current.
- **InputGroup:** `leftIcon`, `onValueChange(value, target)`, `round` — current. `small`/`large` deprecated → `size`.
- `NonIdealState`, `Spinner` (`size`/`intent`), `Card`, `Collapse`, `Icon`, `Navbar*` — current.

## 3. Tables

- **Use `HTMLTable`** (`interactive compact`) for resource lists. It's purely presentational — you own the `<thead>/<tbody>/<tr>/<td>` markup, so row click, per-row ⋮ menu, and column show/hide are trivial. Sticky header via CSS is fine.
- It renders **every row** (no virtualization). Fine to hundreds; at **thousands**, add **external row virtualization** (`@tanstack/react-virtual`) over `<tbody>` — do *not* switch to `Table2`.
- **`Table2`** (`@blueprintjs/table`) is a virtualized **column-addressed grid** (`numRows` + per-`Column` `cellRenderer` + explicit `columnWidths`); it has no first-class row concept, so row-click/row-menu fight the model. Only adopt it for frozen columns / spreadsheet cell-selection.

## 4. Icons

String icon names (`icon="trash"`) are **valid** — loaded async via `autoLoad` (bundler can't tree-shake them; brief async gap on first render). For tree-shaking + synchronous render, import components from `@blueprintjs/icons` and pass elements (`icon={<TrashIcon/>}`). We use string names for simplicity.

## 5. Design tokens (`--bp-*`)

Defined by Blueprint's Style-Dictionary system (NOT the legacy Sass `$pt-*`). **State suffixes are `rest | hover | active | disabled` only** — there is no `hovered`, `selected`, or `subtle`.

| Need | Correct token |
| --- | --- |
| Surface background | `--bp-surface-background-color-{default,primary,success,warning,danger}-{rest,hover,active,disabled}` |
| Border | `--bp-surface-border-color-{default,strong}` |
| Body/secondary text | `--bp-typography-color-default-rest`, muted = **`--bp-typography-color-muted`** (NOT `--bp-text-color-*`) |
| Intent (theme-invariant) | `--bp-intent-{primary,success,warning,danger}-{rest,hover,active,disabled,foreground}` |
| Hover/pressed surface | `--bp-surface-background-color-default-hover` (`#f6f7f9`) / `-active` (`#edeff2`) |
| "Selected" row | no token — use `--bp-surface-background-color-primary-rest` (strong) or `--bp-surface-layer-color-primary` (subtle tint), or the `Classes.SELECTED` class |
| Focus | `--bp-emphasis-focus-{color,width,offset}` |

**No `--bp-app-*` token exists.** Core doesn't paint `body`, so the app must: we paint `body { background: var(--bp-surface-background-color-default-rest) }` (idiomatic; auto-flips under dark). For a gray-desk / white-card look, paint the shell with `-default-hover` and keep cards on `-default-rest`.

**Dark mode:** toggle exactly **`bp6-dark`** (use `Classes.DARK`) or `data-bp-color-scheme="dark"` on a container — tokens auto-flip. Only surface bg/border/shadow and default text have dark overrides; intents are theme-invariant.

## 6. Portals (why overlays escape our scroll containers)

`Portal` (`portal.tsx`) detaches its children and appends a `.bp6-portal` div to
`container ?? PortalProvider.portalContainer ?? document.body`, then `createPortal`s
into it — to "circumvent DOM z-stacking." **Every Blueprint overlay portals by default**
(`usePortal` true): `PopoverNext`, `Drawer`, `Alert`, `Dialog`, `Tooltip`, and the
context menu.

- **Why it mattered for us:** portalling means overlays render on `document.body`, *outside*
  our `.outletBody`/`ObjectTable` `overflow:auto` containers — so the corner-menu bug was
  **never a clipping problem** (portals already avoid clipping). It was the deprecated
  react-popper `Popover` failing to resolve its target ref under React 19. Fixed by
  `PopoverNext` (§1), not by any portal change.
- **Theming through portals — the load-bearing detail:** portalled content lands on
  `document.body`. We toggle **`bp6-dark` on `document.body`** (`applyTheme` →
  `document.body.classList`), so portalled overlays sit *inside* the dark scope and every
  `--bp-*` token flips correctly. CSS-Module classes still apply (they're global hashed
  classes in a `<head>` stylesheet, reachable from any DOM subtree, portal included).
- **Decision: no `<PortalProvider>` needed.** It's optional (unlike `OverlaysProvider`, which
  overlays *require*). Portal falls back to `document.body` without it. Add one **only** if we
  either (a) move the theme class off `document.body` onto a nested container — then set
  `<PortalProvider portalClassName={isDark ? Classes.DARK : ""}>` so overlays stay themed — or
  (b) need portals scoped to a specific container (e.g. a fullscreen element). Neither applies
  today, so keeping the theme class on `document.body` is the simplest correct choice.
- Avoid the `stopPropagationEvents` prop — it's deprecated and non-functional in React 17+.

## 7. Classes & typography

- **Never hardcode `bp6-*` class strings** in JS or CSS. Use the `Classes` constants
  (`Classes.DARK`, `Classes.TEXT_MUTED`, `Classes.HEADING`, …) — they're forward-compatible
  across versions. We currently hardcode **zero** Blueprint class names.
- **Prefer component props over modifier classes:** `variant="minimal"`, `intent="primary"`,
  `size="small"` — not `className={Classes.MINIMAL}`. Modifiers are CSS classes that **cascade to
  children and can't be disabled on descendants** (a `variant="minimal"` child of an
  `variant="outlined"` `ButtonGroup` has no effect).
- **`--bp-*` tokens are NOT class names** — they're design tokens (CSS custom properties). The
  "don't hardcode class names" rule doesn't apply to them; using `var(--bp-…)` in CSS Modules is
  correct.
- **Typography:** base font is 14px. **Don't hardcode px font-sizes** — use `Classes.TEXT_SMALL` /
  `TEXT_LARGE` / `TEXT_MUTED` / `TEXT_DISABLED`, `Classes.RUNNING_TEXT` for longform, and the
  heading components **`<H1>`–`<H6>`** (or `Classes.HEADING`) instead of raw `<h*>` tags. There are
  **no `--bp-typography-font-size-*` CSS vars** — sizes come from these classes. The
  `@blueprintjs/eslint-plugin` `blueprint-html-components` rule enforces the `<H*>` convention.
- **Dark theme cascades** from a `bp6-dark` container to all nested `.bp6-*`. `Popover`/`Tooltip`
  auto-detect a dark *trigger* and dark-class themselves; **`Dialog`/`Drawer`/`Alert`/Toast do
  NOT auto-detect** — so putting `bp6-dark` on **`document.body`** (our approach) is what themes
  them (and all portalled overlays) correctly. No light-in-dark nesting is supported.
- **Enforcement:** `@blueprintjs/eslint-plugin` (`blueprint-html-components`, deprecated-prop and
  hardcoded-class rules) is the mechanism to lock all of §1–§7 in — tracked in the regression-test todo.

**Applied in Heimdall:** `<H3>` for the outlet title; `Classes.TEXT_SMALL`+`TEXT_MUTED` for table
headers and the item count; `Classes.DARK` toggled on `document.body` by `applyTheme`.

## Heimdall conventions

- CSS Modules per component, colored **only** with `--bp-*` tokens (no hardcoded hex except cluster-avatar colors, which are data).
- Theme via `applyTheme()` toggling `Classes.DARK` + `color-scheme`; default from OS, persisted.
- One `ObjectTable` (`HTMLTable`) + a descriptor registry; overlays via `PopoverNext`/`showContextMenu`/`Drawer`/`Alert`.

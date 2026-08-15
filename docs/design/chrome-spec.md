# Chrome spec

The shell's design system: the frame, the ramp, and the handful of rules that
keep it coherent. Content inside the outlet follows Blueprint defaults — this
document covers the chrome around it, which is authored once and shared by every
app.

Everything here is implemented in [`app/ui/theme.css`](../../app/ui/theme.css)
and the `*.module.css` files under [`app/ui/shell/`](../../app/ui/shell). Where a
number appears in both, this document is the explanation and the CSS is the
truth.

## The one rule

**The chrome is expressed in `--bp-palette-*` tokens, never in sampled hexes.**
Blueprint ships 206 palette custom properties; every chrome surface below is a
named entry in that palette. A hardcoded hex in chrome CSS is a bug — it drifts
from the palette on a Blueprint upgrade and it cannot follow a theme flip.

| Surface | Token |
| --- | --- |
| `#111418` | `--bp-palette-black` |
| `#1c2127` | `--bp-palette-dark-gray-1` |
| `#252a31` | `--bp-palette-dark-gray-2` |
| `#abb3bf` | `--bp-palette-gray-4` |
| `#f6f7f9` | `--bp-palette-light-gray-5` |
| `#edeff2` | `--bp-palette-light-gray-4` |
| `#d3d8de` | `--bp-palette-light-gray-1` |

## Frame geometry

```
┌───────────────┬──────────────────────────────────────────┐
│ rail          │ header                          50px     │  dark-gray-1
│ 50 / 230px    ├──────────────────────────────────────────┤
│               │ outlet                                   │  black (dark)
│ dark-gray-2   │                                          │  light-gray-5 (light)
└───────────────┴──────────────────────────────────────────┘
```

| Region | Geometry | Fill / border |
| --- | --- | --- |
| Rail, expanded | `230 × 100%` | `dark-gray-2`, `border-right: 1px rgba(17,20,24,.4)`, text `light-gray-5` |
| Rail, collapsed | `50 × 100%` | as above |
| Rail header | `× 50` | transparent — shares the header's baseline |
| Group header | `× 32` | transparent, 12px `gray-4` |
| Nav entry | `× 32` | transparent, `padding: 0 17px`, 14px/400 `light-gray-5` |
| Nav entry, active | `× 32` | `dark-gray-1`, `font-weight: 600` |
| Application entry | `× 36` | 36 because its tile is 24px where every other glyph is 16 |
| Header | `× 50` | `dark-gray-1` |
| Outlet | remainder | dark: `black`; light: `light-gray-5`, panels `#fff` |

## Chrome rules

- **50px is the chrome row height.** The header and the rail's own header share
  one baseline, so the product mark lines up with the page's actions.
- **The active nav row is recessed, not highlighted** — painted `dark-gray-1`,
  one step *darker* than the `dark-gray-2` rail, plus weight 600. No left accent
  bar, no primary tint, no shadow.
- **Chrome is always dark; content follows the theme.** The rail is
  `dark-gray-2` under both light and dark content.
- **Rows are full-bleed.** `border-radius: 0`, spanning the rail's full width,
  inset with `padding: 0 17px`. Not a floating pill.
- **Surfaces step by one gray.** black → dark-gray-1 → dark-gray-2 is the whole
  dark ramp. Nothing else is introduced.

## Elevation: two steps, not a ramp

A thing either rests in the page or floats over it. There is no third case.

| Step | Used by | Shadow |
| --- | --- | --- |
| Resting | inline panels, legends | `0 0 0 1px rgba(0,0,0,.15), 0 0 5px rgba(0,0,0,.02)` |
| Floating | popovers, menus, dialogs | `0 0 0 1px rgba(17,20,24,.1), 0 20px 25px -5px rgba(0,0,0,.1), 0 10px 15px -3px rgba(0,0,0,.1)` |

Both open with a 1px ring and neither uses a border: **rings and elevation,
never hairlines.** The resting step's blur is almost nothing — 5px at 2% alpha —
so it reads as a crisp edge rather than a shadow. Panel and dialog separators
follow the same instinct and are `box-shadow: 0 1px 0 rgba(17,20,24,.15)`, not
`border-bottom`.

## Control vocabulary

| | Value |
| --- | --- |
| Button heights | 30px default; 24px and 20px in dense toolbar rows |
| Radius | `4px` everywhere — panels, dialogs, menus, menu items, app tiles |
| Padding | `4px 8px` at 30px; `0 8px` at 24/20px |
| Type | 14px/400 throughout |

One radius and one type size carry the entire interface; the only variable is
height. Variation comes from density, never from a new radius or font size.

## Three title sizes, three jobs

They are not interchangeable, and picking the wrong one is the most common way
to make a page look unlike the rest of the app.

| Surface | Treatment |
| --- | --- |
| Chrome-row resource trail | 14px/400 — path muted, subject full strength |
| Listing title, in content | **18px/600** on a row with the page's actions |
| Home greeting | 36px/400, over cards |

The 36px size is a zero-state hero and belongs only on a page with nothing to
disambiguate. A listing page — a table of things you own — titles itself at
18px/600 directly above the table, with its actions right-aligned on the same
row. Nothing on such a page is larger.

**A home page carries no chrome row at all**: no tile, no trail, no actions. The
rule this comes from is not "home pages are bare" — it is that *chrome exists to
say which of several things you are looking at*. A resource page needs it. A
home page is the one place there is nothing to disambiguate, so the space goes
to the content.

## Popovers and menus

Portalled content is the one place theming reliably goes wrong.
[`applyTheme()`](../../app/ui/use-theme.ts) puts the theme class on `<html>`
*and* `<body>`, and Blueprint's dark rules are descendant selectors, so
everything portalled into `<body>` inherits dark whether or not it should.
[`app/ui/menu-popover.tsx`](../../app/ui/menu-popover.tsx) re-asserts the light
treatment for menus.

| Element | Value |
| --- | --- |
| Popover | radius `4px`, the floating shadow |
| Popover content | `#fff`, `color: #1c2127`, `padding: 0` |
| Arrow | fill `#fff`, border path `rgb(17,20,24)` — a separate SVG path, so surface rules miss it |
| Menu | `#fff`, radius `4px`, `min-width: 180px`, `padding: 4px` |
| Menu item | 30px, `padding: 4px 8px`, radius `4px`, `line-height: 22px` |
| Menu item `:hover` | `rgba(143,153,168,.15)` |
| Divider | `border-top: 1px solid rgba(17,20,24,.15)` |

Intent text uses the palette's **-2** shades, and this is an accessibility
requirement rather than a preference:

| Intent | Value | Token | Contrast on `#fff` |
| --- | --- | --- | --- |
| primary | `#215db0` | `--bp-palette-blue-2` | 6.45 |
| success | `#1c6e42` | `--bp-palette-green-2` | 6.25 |
| warning | `#935610` | `--bp-palette-orange-2` | 5.87 |
| danger | `#ac2f33` | `--bp-palette-red-2` | 6.55 |

On a dark-themed document the dark shades leak into a white menu — danger
arrives as `#fa999c`, **2.08:1** on white, which fails WCAG AA outright.

## Thin scrollbars

```css
::-webkit-scrollbar            { background: 0 0; }
::-webkit-scrollbar:horizontal { border-top: 1px solid rgba(17, 20, 24, .15); }
::-webkit-scrollbar:vertical   { border-left: 1px solid rgba(17, 20, 24, .15); }
::-webkit-scrollbar-thumb {
  background-color: rgba(17, 20, 24, .25);
  background-clip: padding-box;
  border: 4px solid rgba(0, 0, 0, 0);   /* ← the whole trick */
  border-radius: 8px;
}
```

**No width is set anywhere.** The bar keeps its natural size and the *thumb* is
inset by a transparent 4px border with `background-clip: padding-box`, so what
you see is thin while what you can grab is not. Narrowing the bar itself would
shrink the hit target with it.

The track is transparent with a hairline on its inner edge only — `border-top`
horizontally, `border-left` vertically — so the bar closes a table's frame
instead of reading as a channel bolted onto it.

## The rail, collapsed

Collapsing narrows the rail to 50px; it does not shorten it.

- **Every entry survives.** A group that exists expanded and not collapsed is a
  bug.
- **Group headers vanish and a 21px divider carries the break.** Nothing is
  relabelled or merged; the rule is the only thing left saying a group ended.
- **Heights and glyphs are preserved** — 32px everywhere, 36px for application
  rows, whose 24px tile stays nested in the same 16px icon slot and overflows it
  by 4px a side in both states. That is what keeps every label on one inset when
  expanded.

## Application tiles are a wash

An app icon is **one colour used twice**: the tile is that colour at 10% alpha,
the glyph is the same colour at full strength.

```
24 × 24, border-radius 4px, padding 0
  background-color   <the app's colour> at 10% alpha
  background-size    16px
  element opacity    1     ← the transparency is in the colour, not the element
```

A saturated tile with a contrasting glyph reads as a button. The wash sits back
and lets the label lead. Keeping the transparency in the colour means `opacity`
stays 1, so the glyph never dims along with its tile.

## Group headers list favourites, not everything

A group in the rail is a *subset* by definition — what has been favourited, not
the whole catalogue. So a group header has three parts and all three matter: the
title, a hover-revealed **View all** reaching the rest, and rows that each carry
a filled gold (`#fbd065`) star. The star is not a control you go hunting for; it
is the mark saying why the row is there, and pressing it takes the row away.

## Navigation entries: link or popover

Whether an entry is an `<a>` or a `role="button"` with a popover comes down to
one question: **is there a page to go to?** Recents has no page of its own, so
it opens its list in a popover rather than linking nowhere.

## Breadcrumb overflow is a shrink chain

Two mechanisms, and the second exists only because of the first.

*Within* a crumb, the label ellipsises with no max-width of its own. *Across*
crumbs, the trail collapses from the start, bounded by flex:

| Element | flex | min-width | max-width |
| --- | --- | --- | --- |
| trail container | `1 1 0%` | `0` | none |
| the path | `0 1 auto` | **`40px`** | none |
| the subject | `0 1 auto` | **`80px`** | **`250px`** |

The path's 40px floor is exactly the collapsed indicator plus its chevron, so
the trail shrinks until nothing is left but the ellipsis and then stops. The
subject is capped at 250 and never yields below 80: **the subject survives at
the cost of its ancestors.**

When the path collapses, the crumb is replaced wholesale by a 24px popover
target with its own accessible name (`More folders`) listing what was hidden.
Nothing becomes unreachable by getting narrow.

## Tables

| Element | Value |
| --- | --- |
| Column header | 30px, 12px/400 UPPERCASE, `gray-1` |
| Header padding | `0 11px 0 20px` |
| Row | 42px, 14px/400 |
| Cell padding | `0 11px 0 20px` — a 20px inset on the leading column |
| Row icon | 14px, one per row, coloured by kind |
| Filter field | 30px, 14px, 30px left padding for its inline glyph |
| Result count | `40 of 40`, 12px, **inside the filter field** |

Two of these carry more weight than the numbers. Uppercase 12px headers read as
*table furniture* rather than as data. And a count that lives inside the filter
field and reports filtered-of-total says more than a standalone `9 items` while
costing no vertical space.

Empty cells get a muted italic **No value**, not a bare em dash — absence is
stated rather than punctuated.

## Dialogs

| Element | Value |
| --- | --- |
| Frame | radius `4px`, `padding: 0` |
| Shadow | the floating step, identical to a popover's |
| Header | 38px, `padding: 4px 4px 4px 16px`, radius `4px 4px 0 0` |
| Header title | **14px/400** — body text, not a display size |
| Header separator | `box-shadow: 0 1px 0 rgba(17,20,24,.15)` |
| Backdrop | `rgba(17,20,24,.7)`, no backdrop-filter |

Settings is a **window, not a page**: a dialog over a dimmed app keeps the
cluster you were looking at visible behind it, so changing a setting does not
feel like leaving what you were doing. Anything with an immediate effect — the
theme, a feature switch — applies on the control rather than on a Save, so the
footer exists only for the settings that genuinely need committing (the
connection details, where a half-typed URL should not be applied keystroke by
keystroke). The title is body text — a dialog is identified by its frame, not
by a heading shouting its name. The asymmetric header padding is deliberate: 16px
of text inset on the left, 4px on the right, where the close button sits.

The applications portal is the one dialog that sizes itself off the viewport —
90% in both axes — and stays dark regardless of theme:

```
backdrop      rgba(17, 20, 24, .7)
dialog        90% × 90%, #1c2127, radius 4px
  header      49px — the search field, 40px tall at 16px
  left side   250px, border-right 1px rgba(255,255,255,.2)
app row       icon 30 × 30 · name 14px/400 · description 12px #abb3bf · star 16px #fbd065
```

**The search field is the header.** There is no title bar: the dialog opens with
the cursor in a field, because past a handful of apps searching is the primary
act and browsing the secondary one. Every app carries a sentence — a grid of
names alone would make you open each one to learn what it does.

## Deliberate divergences

Two places where the obvious treatment is the wrong one, recorded so they do not
get "fixed" later.

**Favourite controls are `opacity: 0`, not `display: none`.** A hidden-by-opacity
button still takes focus, and `.pin:focus-visible` brings it to 0.55, so the
control is reachable by keyboard. `display: none` cannot be focused at all,
which makes per-row favourites mouse-only. The cost is honest: a pin on every
row means two tab stops per nav entry. That is inherent to any per-row control
that stays keyboard-reachable, and it is accepted rather than worked around.

**Table headers are title case at body size**, not uppercase 12px. A Kubernetes
list has a fixed schema per kind, and the column names are short domain nouns
that read better as words than as furniture.

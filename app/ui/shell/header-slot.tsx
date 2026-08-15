import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { createPortal } from "react-dom";

/**
 * A slot in the app header that any page can render into.
 *
 * A page's own actions belong in the resource header rather than in a strip
 * above the content: the header carries a custom-actions slot holding that
 * page's controls, beside the breadcrumb. The effect is that
 * the chrome row is the same object everywhere and the content area is only
 * content; a table starts at the top of its pane instead of 42px down behind a
 * bar of filters.
 *
 * A portal rather than prop-drilling because the producer and the consumer are
 * far apart in the tree — the page is several levels below the header and has no
 * route to it — and because the alternative, hoisting every page's controls into
 * the shell, would put each page's state there too.
 *
 * The node is `null` until the header mounts and on routes that render no header
 * at all (the Catalog), and `HeaderActions` renders nothing in that case rather
 * than throwing. A page whose actions have nowhere to go should lose the actions,
 * not the page.
 */
const HeaderSlotContext = createContext<HTMLElement | null>(null);

/** A component rather than `HeaderSlotContext.Provider` re-exported.
 *
 *  A bare Provider is a value, not a component definition, so a module that
 *  exports one alongside a real component loses Fast Refresh for the whole file
 *  — eslint-plugin-react-refresh started saying so in 0.5. Same props, same call
 *  site; it just gives the linter a component to recognise. */
export function HeaderSlotProvider({ value, children }: { value: HTMLElement | null; children: ReactNode }) {
  return <HeaderSlotContext.Provider value={value}>{children}</HeaderSlotContext.Provider>;
}

/** Render children into the header's action area, if there is one. */
export function HeaderActions({ children }: { children: ReactNode }) {
  const node = useContext(HeaderSlotContext);
  return node ? createPortal(children, node) : null;
}

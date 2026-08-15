import { Button, Icon, Menu, MenuDivider, MenuItem } from "@blueprintjs/core";
import { useSyncExternalStore } from "react";
import { MenuPopover } from "../menu-popover";
import {
  clearNotifications,
  type NotificationIntent,
  notificationHistory,
  subscribeNotifications,
} from "../notifications";
import styles from "./notifications-button.module.css";

const INTENT_ICON: Record<NotificationIntent, "tick-circle" | "info-sign" | "error"> = {
  success: "tick-circle",
  primary: "info-sign",
  danger: "error",
};

/**
 * Recent notifications, from notify's history.
 *
 * Two shapes for one menu. `entry` is the sidebar destination — an
 * icon-and-label row in the list, with no bell in the header at all. The
 * default is the bare bell, still used by the collapsed rail where
 * there is no room for a label.
 */
export function NotificationsButton({
  variant = "icon",
  className,
  showLabel = true,
  placement = "bottom-end",
}: {
  variant?: "icon" | "entry";
  className?: string;
  /** Entry variant only: drop the label for the collapsed rail, keeping the
   *  plain-button markup so the glyph lands on the same 17px inset as every
   *  other row. A Blueprint <Button> centres its own content inside its own
   *  padding and put the bell at 10 while its neighbours sat at 17. */
  showLabel?: boolean;
  placement?: "bottom-end" | "right-start";
} = {}) {
  const items = useSyncExternalStore(subscribeNotifications, notificationHistory, notificationHistory);
  // The badge is decoration (aria-hidden), so the count has to reach assistive
  // tech through the button's own name — otherwise it is invisible to anyone
  // not looking at the pixel.
  const label = items.length > 0 ? `Notifications (${items.length})` : "Notifications";
  return (
    <MenuPopover
      placement={placement}
      content={
        <Menu className={styles.menu}>
          {items.length === 0 ? (
            /* Not a disabled <MenuItem>. An empty state is a statement, not a
               control you cannot use, and Blueprint's disabled colour is set for
               the dark theme — in a white popover it composited to roughly
               1.6:1, i.e. barely visible. This is muted text at full strength. */
            <li className={styles.empty}>No notifications</li>
          ) : (
            <>
              {items.slice(0, 20).map(n => (
                <MenuItem
                  key={n.id}
                  icon={<Icon icon={INTENT_ICON[n.intent]} intent={n.intent} />}
                  text={<span className={styles.msg}>{n.message}</span>}
                  multiline
                />
              ))}
              <MenuDivider />
              <MenuItem icon="clean" text="Clear all" onClick={clearNotifications} />
            </>
          )}
        </Menu>
      }
    >
      {/* The count sits *on* the bell rather than beside it: a badge next to the
          icon widened the button whenever a notification arrived, nudging the
          rest of the header sideways. Overlaid, the control never changes size.

          The badge lives inside the Button rather than in a wrapper around it.
          A wrapper looked tidier but broke accessibility: PopoverNext puts its
          aria-haspopup/aria-expanded on whatever child it is given, and those
          attributes are invalid on a bare <span> — axe flagged it critical. The
          popover's target has to stay the button. */}
      {variant === "entry" ? (
        <button type="button" className={className} aria-label={label}>
          {/* With a label the count belongs at the row's trailing edge. Without
              one — the collapsed rail — there is no row to have an edge, so it
              went in the empty space beside the bell and read as a separate
              object rather than as the bell's own count. It rides the glyph's
              corner instead, which is what the cluster badges do one block
              down in hotbar.module.css. */}
          <span className={showLabel ? undefined : styles.glyph}>
            <Icon icon="notifications" size={16} />
            {!showLabel && items.length > 0 && (
              <span className={styles.glyphCount} aria-hidden>
                {items.length > 9 ? "9+" : items.length}
              </span>
            )}
          </span>
          {showLabel && <span className={styles.entryLabel}>Notifications</span>}
          {showLabel && items.length > 0 && (
            <span className={styles.entryCount} aria-hidden>
              {items.length > 9 ? "9+" : items.length}
            </span>
          )}
        </button>
      ) : (
        <Button
          className={`${styles.bell} ${className ?? ""}`}
          variant="minimal"
          icon="notifications"
          aria-label={label}
        >
          {items.length > 0 ? (
            <span className={styles.badge} aria-hidden>
              {items.length > 9 ? "9+" : items.length}
            </span>
          ) : null}
        </Button>
      )}
    </MenuPopover>
  );
}

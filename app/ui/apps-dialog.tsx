import { Button, Classes, Dialog, Icon, InputGroup, NonIdealState } from "@blueprintjs/core";
import { useMemo, useState } from "react";
import { APPS, type HeimdallApp, toggleFavouriteApp, useFavouriteApps } from "./apps";
import styles from "./apps-dialog.module.css";
import { useDisabledFeatures } from "./feature-flags";

/**
 * The applications portal.
 *
 * A 90%-of-viewport modal over a dimmed
 * page, a search field across the top, a 250px column of categories on the left
 * behind a hairline, and the apps themselves as rows of icon, name and a
 * sentence — each with a favourite star at the trailing edge. Measured at
 * 1152×648 on a 1280×720 viewport, `#1c2127`, 4px radius, and notably rendered
 * **dark even on the light theme**, which is why this uses the dark class
 * outright rather than following the app's.
 *
 * Two departures, both because two apps is not sixty-four:
 *
 * The left column lists no categories. Eleven categories with counts earn
 * their place when there are 64 apps to navigate; here it would be one
 * category containing everything, which is a column of chrome saying nothing. It keeps the "All
 * apps" row and its count, which is the part that still means something.
 *
 * There is no detail pane. A third column would show an app's details on
 * selection; with a one-line description already on every row there would be
 * nothing further to show.
 */
export function AppsDialog({
  isOpen,
  onClose,
  onOpen,
}: {
  isOpen: boolean;
  onClose: () => void;
  onOpen: (app: HeimdallApp) => void;
}) {
  const [query, setQuery] = useState("");
  const favourites = useFavouriteApps();
  const disabled = useDisabledFeatures();

  const available = useMemo(() => APPS.filter(a => !a.flag || !disabled.has(a.flag)), [disabled]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return available;
    return available.filter(a => `${a.name} ${a.description}`.toLowerCase().includes(q));
  }, [available, query]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      className={`${styles.dialog} ${Classes.DARK}`}
      // No `title`, because the portal has no title bar — the search
      // field is the header, and the close button sits at its right end. And no
      // `isCloseButtonShown`: Blueprint ignores it when there is no title and
      // says so in a console warning, so passing it is noise that reads as
      // intent.
      aria-label="Applications"
    >
      <div className={styles.head}>
        <InputGroup
          className={styles.search}
          large
          leftIcon="search"
          placeholder="Search for applications…"
          value={query}
          onValueChange={setQuery}
          autoFocus
        />
        <Button variant="minimal" icon="cross" aria-label="Close" onClick={onClose} />
      </div>
      <div className={styles.content}>
        <div className={styles.left}>
          <div className={`${styles.category} ${styles.categoryActive}`}>
            <span>All apps</span>
            <span className={styles.count}>{available.length}</span>
          </div>
        </div>
        <div className={styles.right}>
          {shown.length === 0 ? (
            <NonIdealState icon="search" title="No matches" description="No application matches that search." />
          ) : (
            shown.map(app => {
              const starred = favourites.includes(app.id);
              return (
                <div key={app.id} className={styles.row}>
                  <button
                    type="button"
                    className={styles.open}
                    onClick={() => {
                      onOpen(app);
                      onClose();
                    }}
                  >
                    <span className={styles.tile} style={{ "--c": app.color } as React.CSSProperties}>
                      <Icon icon={app.icon} size={18} />
                    </span>
                    <span className={styles.text}>
                      <span className={styles.name}>{app.name}</span>
                      <span className={styles.description}>{app.description}</span>
                    </span>
                  </button>
                  {/* Trailing star, always visible here rather than hover-revealed
                      as in the sidebar: this list is where you *choose* what to
                      keep, so the control is the point of the row. */}
                  <Button
                    className={styles.star}
                    variant="minimal"
                    icon={<Icon icon={starred ? "star" : "star-empty"} color={starred ? "#fbd065" : undefined} />}
                    aria-label={`${starred ? "Remove" : "Add"} ${app.name} ${starred ? "from" : "to"} Favorites`}
                    aria-pressed={starred}
                    onClick={() => toggleFavouriteApp(app.id)}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>
    </Dialog>
  );
}

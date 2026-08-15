import { MenuItem } from "@blueprintjs/core";
import { type ItemPredicate, type ItemRenderer, Omnibar } from "@blueprintjs/select";
import { useEffect } from "react";
import { canList, type ResourceRule, servedHas } from "../capabilities";
import { NAV_TREE } from "../nav-tree";
import { RESOURCES } from "../resource/registry";

interface Command {
  id: string;
  label: string;
  group: string;
}

// Flatten the nav tree into jump targets (leaves + top-level items).
const COMMANDS: Command[] = NAV_TREE.flatMap(node =>
  node.children
    ? node.children.map(child => ({ id: child.id, label: child.label, group: node.label }))
    : [{ id: node.id, label: node.label, group: "Cluster" }],
);

/** Same availability rule as the sidebar: feature pages always show; resource
 *  pages show only when the cluster serves their kind. */
function available(pageId: string, served: Set<string> | null, rules: ResourceRule[] | null): boolean {
  const query = RESOURCES[pageId]?.watchQuery;
  if (!query) return true;
  return servedHas(served, query.apiVersion, query.resource) && canList(rules, query.apiVersion, query.resource);
}

const predicate: ItemPredicate<Command> = (query, cmd) =>
  `${cmd.label} ${cmd.group}`.toLowerCase().includes(query.toLowerCase());

const renderer: ItemRenderer<Command> = (cmd, { handleClick, modifiers }) =>
  modifiers.matchesPredicate ? (
    <MenuItem
      key={cmd.id}
      text={cmd.label}
      label={cmd.group}
      active={modifiers.active}
      onClick={handleClick}
      roleStructure="listoption"
    />
  ) : null;

interface PaletteProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onNavigate: (id: string) => void;
  served: Set<string> | null;
  rules: ResourceRule[] | null;
}

/** Command palette (⌘/Ctrl-K, or the header search) — fuzzy-jump to any resource
 *  view the cluster serves and the user may list. Open state owned by the shell. */
export function CommandPalette({ open, onToggle, onClose, onNavigate, served, rules }: PaletteProps) {
  const items = COMMANDS.filter(cmd => available(cmd.id, served, rules));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onToggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onToggle]);

  return (
    <Omnibar<Command>
      isOpen={open}
      items={items}
      itemPredicate={predicate}
      itemRenderer={renderer}
      onItemSelect={cmd => {
        onNavigate(cmd.id);
        onClose();
      }}
      onClose={onClose}
      resetOnSelect
      inputProps={{ placeholder: "Jump to a resource…" }}
    />
  );
}

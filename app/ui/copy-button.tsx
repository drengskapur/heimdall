import { Button } from "@blueprintjs/core";
import { useState } from "react";

/**
 * A small copy-to-clipboard button. Briefly swaps its icon to a tick on success
 * (Freelens's copy affordance). Stops click propagation so it works inside rows.
 */
export function CopyButton({
  text,
  size = "small",
  title = "Copy",
}: {
  text: string;
  size?: "small" | "medium" | "large";
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable (insecure context) — no-op */
    }
  };
  return (
    <Button
      variant="minimal"
      size={size}
      icon={copied ? "tick" : "duplicate"}
      intent={copied ? "success" : undefined}
      aria-label={title}
      title={title}
      onClick={copy}
    />
  );
}

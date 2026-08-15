import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  heimdallStatechart,
  navigationStates,
  overlayStates,
  preferenceStates,
} from "../tests/contracts/heimdall-statechart.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "docs", "heimdall-executable-statechart.md");
const safe = id => id.replaceAll(/[^a-zA-Z0-9_]/g, "_");
const lines = [
  "# Heimdall executable full-stack statechart",
  "",
  "This document is generated from `tests/contracts/heimdall-statechart.mjs`. The same declarations drive the UI, hidden-state, FOUC, and backend response-oracle tests.",
  "",
  `Coverage: ${navigationStates.length} navigation states, ${preferenceStates.length} preference states, ${overlayStates.length} hidden/portal states, and ${heimdallStatechart.regions.backend.states.length} backend lifecycle/contract states.`,
  "",
  "```mermaid",
  "stateDiagram-v2",
  "  state UI {",
  "    [*] --> ui_booting",
  "    ui_booting --> ui_ready: portal + styles + fonts ready",
  "    state Navigation {",
  ...navigationStates.map(
    state => `      state "${[state.group, state.label].filter(Boolean).join(" / ")}" as ${safe(state.id)}`,
  ),
  "    }",
  "    state Preferences {",
  ...preferenceStates.map(state => `      state "${state.label}" as ${safe(state.id)}`),
  "    }",
  "    state Hidden_and_portal_states {",
  ...overlayStates.map(state => `      state "${state.label}" as ${safe(state.id)}`),
  "    }",
  "    ui_ready --> Navigation: navigate",
  "    ui_ready --> Preferences: open preferences",
  "    Navigation --> Hidden_and_portal_states: open overlay",
  "    Hidden_and_portal_states --> Navigation: close",
  "  }",
  "  state Backend {",
  "    [*] --> backend_booting",
  "    backend_booting --> backend_ready: worker ready",
  ...heimdallStatechart.regions.backend.states
    .filter(state => !["backend.booting", "backend.ready"].includes(state.id))
    .map(state => `    backend_ready --> ${safe(state.id)}: request\n    ${safe(state.id)} --> backend_ready: settled`),
  "  }",
  "```",
  "",
  "Run `npm run test:statechart` to validate reachability and execute the UI/backend state oracles. Run `npm run statechart:generate` after changing the machine.",
  "",
].join("\n");

if (process.argv.includes("--check")) {
  const current = await readFile(output, "utf8").catch(() => "");
  if (current !== lines) throw new Error("The generated statechart is stale; run npm run statechart:generate");
} else {
  await writeFile(output, lines);
}

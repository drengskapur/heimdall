import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "app");
const sourceExtensions = new Set([".css", ".ts", ".tsx"]);
const suspicious = /Ã|â|Â|ðŸ|Ã¢/u;
const failures = [];
let files = 0;

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(target);
      continue;
    }
    if (!sourceExtensions.has(path.extname(entry.name))) continue;
    files++;
    const lines = (await readFile(target, "utf8")).split(/\r?\n/u);
    lines.forEach((line, index) => {
      if (suspicious.test(line))
        failures.push(`${path.relative(root, target)}:${index + 1}: ${line.trim().slice(0, 180)}`);
    });
  }
}

await visit(root);
if (failures.length) {
  console.error(`[encoding] found ${failures.length} likely mojibake artifacts`);
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`[encoding] PASS ${files} UI source files contain no likely mojibake artifacts`);
}

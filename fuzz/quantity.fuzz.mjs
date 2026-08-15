// Resource strings as the Kubernetes API reports them: "128Mi", "250m", "1.5".
// Parsing must always yield a number — NaN is acceptable, a throw is not,
// because every caller renders the result straight into a table cell.
// Imported from .fuzz-build, not from source: Jazzer installs its own
// instrumenting module loader, which displaces tsx, so the code under test has
// to already be JavaScript. `npm run fuzz` compiles it first.
const { CpuQuantity, MemoryQuantity } = await import("../.fuzz-build/app/domain/values/quantity.js");

export function fuzz(data) {
  const text = data.toString("utf8");
  for (const parsed of [CpuQuantity.parse(text), MemoryQuantity.parse(text)]) {
    const value = parsed instanceof CpuQuantity ? parsed.cores : parsed.bytes;
    if (typeof value !== "number") throw new Error(`parse produced ${typeof value}`);
    // format() renders into the UI, so it must return a string for any input
    // the parser accepted — including the NaN it is allowed to produce.
    if (typeof parsed.format() !== "string") throw new Error("format did not return a string");
  }
}

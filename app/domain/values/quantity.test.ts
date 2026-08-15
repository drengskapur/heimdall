import assert from "node:assert/strict";
import { test } from "node:test";
import { CpuQuantity, MemoryQuantity } from "./quantity";

test("CpuQuantity parses cores and suffixes", () => {
  assert.equal(CpuQuantity.parse("100m").cores, 0.1);
  assert.equal(CpuQuantity.parse("2").cores, 2);
  assert.equal(CpuQuantity.parse("500000u").cores, 0.5);
  assert.equal(CpuQuantity.parse("250000000n").cores, 0.25);
  assert.equal(CpuQuantity.parse(undefined).cores, 0);
  assert.equal(CpuQuantity.parse("").cores, 0);
});

test("CpuQuantity sums and formats", () => {
  const total = CpuQuantity.parse("100m").plus(CpuQuantity.parse("150m"));
  assert.equal(total.toMillicores(), 250);
  assert.equal(total.format(), "250m");
  assert.equal(CpuQuantity.parse("1500m").format(), "1.5");
});

test("CpuQuantity.parse handles numbers and rejects invalid input", () => {
  assert.equal(CpuQuantity.parse(0.5).cores, 0.5);
  assert.equal(CpuQuantity.parse("abc").cores, 0);
  assert.equal(CpuQuantity.parse(Number.NaN).cores, 0);
  assert.equal(CpuQuantity.parse("1.5").cores, 1.5, "plain decimal, no suffix");
  assert.equal(CpuQuantity.parse(null).cores, 0);
});

test("MemoryQuantity.parse handles numbers, unknown suffixes, and invalid input", () => {
  assert.equal(MemoryQuantity.parse(2048).bytes, 2048);
  assert.equal(MemoryQuantity.parse("100Zz").bytes, 100, "unknown suffix → factor 1");
  assert.equal(MemoryQuantity.parse("nope").bytes, 0);
  assert.equal(MemoryQuantity.parse(null).bytes, 0);
  assert.equal(MemoryQuantity.parse("1.5Ki").bytes, 1.5 * 1024);
});

test("CpuQuantity.format switches to cores at exactly 1", () => {
  assert.equal(CpuQuantity.parse("999m").format(), "999m");
  assert.equal(CpuQuantity.parse("1").format(), "1");
  assert.equal(CpuQuantity.parse("1500m").format(), "1.5");
  assert.equal(CpuQuantity.zero().format(), "0m");
});

test("MemoryQuantity.format picks the right binary unit at boundaries", () => {
  assert.equal(MemoryQuantity.parse(1023).format(), "1.0Ki");
  assert.equal(MemoryQuantity.parse(1024).format(), "1.0Ki");
  assert.equal(MemoryQuantity.parse(1024 ** 2).format(), "1.0Mi");
  assert.equal(MemoryQuantity.parse(1024 ** 3).format(), "1.0Gi");
  assert.equal(MemoryQuantity.parse(1024 ** 4).format(), "1.0Ti");
});

test("MemoryQuantity parses binary and decimal suffixes", () => {
  assert.equal(MemoryQuantity.parse("128Mi").bytes, 128 * 1024 ** 2);
  assert.equal(MemoryQuantity.parse("1Gi").bytes, 1024 ** 3);
  assert.equal(MemoryQuantity.parse("1M").bytes, 1e6);
  assert.equal(MemoryQuantity.parse("512").bytes, 512);
  assert.equal(MemoryQuantity.parse(undefined).bytes, 0);
});

test("quantities are value objects (structural equality via the shared kernel)", () => {
  assert.equal(CpuQuantity.parse("100m").equals(CpuQuantity.parse("0.1")), true);
  assert.equal(CpuQuantity.parse("100m").equals(CpuQuantity.parse("200m")), false);
  assert.equal(MemoryQuantity.parse("1Gi").equals(MemoryQuantity.parse("1024Mi")), true);
});

test("MemoryQuantity sums and formats in binary units", () => {
  const total = MemoryQuantity.parse("512Mi").plus(MemoryQuantity.parse("512Mi"));
  assert.equal(total.bytes, 1024 ** 3);
  assert.equal(total.format(), "1.0Gi");
  assert.equal(MemoryQuantity.parse("24Mi").format(), "24.0Mi");
});

// The parse regex is the whole contract for a memory string, and mutation
// testing showed its anchors, its fractional part and its trim were all free to
// change: every test fed it a well-formed value.
test("MemoryQuantity.parse anchors the whole string, so a malformed value is not salvaged", () => {
  // Junk before or after the number must not be quietly ignored — without the
  // anchors these would parse as 128Mi.
  assert.equal(MemoryQuantity.parse("x128Mi").bytes, 0);
  assert.equal(MemoryQuantity.parse("128Mi!").bytes, 0);
  assert.equal(MemoryQuantity.parse("128 Mi").bytes, 0);
});

test("MemoryQuantity.parse keeps every digit of a fraction", () => {
  // A one-digit fractional pattern would stop at "1.2" and then fail to match
  // the rest, silently yielding zero.
  assert.equal(MemoryQuantity.parse("1.25Gi").bytes, 1.25 * 1024 ** 3);
  assert.equal(MemoryQuantity.parse("1.5Mi").bytes, 1.5 * 1024 ** 2);
});

test("MemoryQuantity.parse trims surrounding whitespace", () => {
  assert.equal(MemoryQuantity.parse(" 128Mi ").bytes, 134217728);
  assert.equal(MemoryQuantity.parse("\t64Ki\n").bytes, 65536);
});

test("zero quantities are actually zero", () => {
  assert.equal(MemoryQuantity.zero().bytes, 0);
  assert.equal(CpuQuantity.zero().cores, 0);
});

test("MemoryQuantity.format falls back to Ki below one kibibyte", () => {
  // The smallest unit in the table is the fallback when nothing matches, so
  // sub-Ki values are the only thing that exercises it.
  assert.equal(MemoryQuantity.parse(512).format(), "0.5Ki");
  assert.equal(MemoryQuantity.parse(0).format(), "0.0Ki");
  assert.equal(MemoryQuantity.parse(1023).format(), "1.0Ki");
});

// Domain value objects for Kubernetes resource quantities. Pure and immutable —
// no infrastructure, no framework. Kubernetes expresses CPU in cores (with an
// optional SI/binary suffix) and memory in bytes (with a decimal/binary suffix).
import { ValueObject } from "../shared/building-blocks";

const CPU_SUFFIX: Record<string, number> = { n: 1e-9, u: 1e-6, m: 1e-3 };
const BYTE_SUFFIX: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  Ei: 1024 ** 6,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  k: 1e3,
};

/** A CPU quantity, normalised to cores. `100m` → 0.1, `2` → 2. */
export class CpuQuantity extends ValueObject<{ cores: number }> {
  private constructor(cores: number) {
    super({ cores });
  }
  get cores(): number {
    return this.props.cores;
  }

  static parse(value: string | number | undefined | null): CpuQuantity {
    // "" needs no branch of its own: Number("") is 0, which is where it lands.
    if (value === undefined || value === null) return new CpuQuantity(0);
    if (typeof value === "number") return new CpuQuantity(Number.isFinite(value) ? value : 0);
    // Trimmed, as MemoryQuantity's pattern effectively is: untrimmed, "100m "
    // read its suffix as a space, missed the milli branch and fell through to
    // Number("100m ") — NaN, displayed as 0m.
    value = value.trim();
    const suffix = value.slice(-1);
    const factor = CPU_SUFFIX[suffix];
    const magnitude = factor ? Number(value.slice(0, -1)) * factor : Number(value);
    return new CpuQuantity(Number.isFinite(magnitude) ? magnitude : 0);
  }

  static zero(): CpuQuantity {
    return new CpuQuantity(0);
  }
  plus(other: CpuQuantity): CpuQuantity {
    return new CpuQuantity(this.cores + other.cores);
  }
  /** Millicores, the display unit Kubernetes tools use. */
  toMillicores(): number {
    return this.cores * 1000;
  }
  format(): string {
    return this.cores >= 1 ? `${+this.cores.toFixed(3)}` : `${Math.round(this.toMillicores())}m`;
  }
}

/** A memory (byte) quantity. `128Mi` → 134217728. */
export class MemoryQuantity extends ValueObject<{ bytes: number }> {
  private constructor(bytes: number) {
    super({ bytes });
  }
  get bytes(): number {
    return this.props.bytes;
  }

  static parse(value: string | number | undefined | null): MemoryQuantity {
    // "" needs no branch of its own: it fails the pattern and Number("") is 0.
    if (value === undefined || value === null) return new MemoryQuantity(0);
    if (typeof value === "number") return new MemoryQuantity(Number.isFinite(value) ? value : 0);
    // Stryker disable next-line Regex: making the suffix required is equivalent —
    // a plain number then misses the pattern and reaches Number(value) below,
    // which returns the same magnitude. Both spellings are needed anyway:
    // Kubernetes also accepts scientific notation ("1e6"), which only Number
    // handles.
    const match = /^(\d+(?:\.\d+)?)([A-Za-z]+)?$/.exec(value.trim());
    if (!match) {
      const n = Number(value);
      return new MemoryQuantity(Number.isFinite(n) ? n : 0);
    }
    const factor = match[2] ? (BYTE_SUFFIX[match[2]] ?? 1) : 1;
    return new MemoryQuantity(Number(match[1]) * factor);
  }

  static zero(): MemoryQuantity {
    return new MemoryQuantity(0);
  }
  plus(other: MemoryQuantity): MemoryQuantity {
    return new MemoryQuantity(this.bytes + other.bytes);
  }

  /** Human-readable binary units aligned to Kubernetes conventions (Ki/Mi/Gi/…). */
  format(): string {
    // Below 1Ki there is no separate case: no factor matches, and the fallback
    // below is Ki, which is the same answer the early return used to give.
    const units: Array<[number, string]> = [
      [1024 ** 4, "Ti"],
      [1024 ** 3, "Gi"],
      [1024 ** 2, "Mi"],
      [1024, "Ki"],
    ];
    const [factor, unit] = units.find(([f]) => this.bytes >= f) ?? units[units.length - 1];
    return `${(this.bytes / factor).toFixed(1)}${unit}`;
  }
}

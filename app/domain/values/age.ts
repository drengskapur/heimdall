// Age value object: the duration since a creation timestamp, formatted the way
// kubectl/Lens abbreviate it (s/m/h/d). Pure and reusable across every list.

export class Age {
  private constructor(readonly seconds: number) {}

  /** Build from an ISO creation timestamp relative to `now` (ms). */
  static since(creationTimestamp: string | undefined | null, now: number): Age {
    // Stryker disable next-line ConditionalExpression: equivalent. Without the
    // guard, Date.parse(undefined) is NaN and NaN propagates through Math.max to
    // the same Age(NaN). Kept because an explicit "no timestamp, no age" reads
    // better than relying on NaN arithmetic.
    if (!creationTimestamp) return new Age(Number.NaN);
    const created = Date.parse(creationTimestamp);
    // Stryker disable next-line ConditionalExpression: equivalent, for the same
    // reason — Math.max(0, NaN) is NaN.
    if (Number.isNaN(created)) return new Age(Number.NaN);
    return new Age(Math.max(0, Math.floor((now - created) / 1000)));
  }

  /** Milliseconds of the creation timestamp, for sorting (0 when unknown). */
  static epochMillis(creationTimestamp: string | undefined | null): number {
    return creationTimestamp ? Date.parse(creationTimestamp) || 0 : 0;
  }

  get known(): boolean {
    return !Number.isNaN(this.seconds);
  }

  format(): string {
    if (!this.known) return "";
    const s = this.seconds;
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  }
}

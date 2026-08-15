// Tactical DDD building blocks (seedwork). Base types the domain composes from,
// so value objects and entities get their identity/equality semantics for free.

/** A value object is defined by its attributes and compared by structural
 *  equality. Extend and expose read-only props; two instances with equal props
 *  are equal. Keep props flat/serialisable for a meaningful comparison. */
export abstract class ValueObject<Props extends Record<string, unknown>> {
  protected constructor(protected readonly props: Props) {}

  equals(other?: ValueObject<Props>): boolean {
    if (other === undefined || other === null) return false;
    if (other.constructor !== this.constructor) return false;
    return JSON.stringify(this.props) === JSON.stringify(other.props);
  }
}

/** An entity has a stable identity; equality is by id and type, not attributes. */
export abstract class Entity<Id> {
  protected constructor(readonly id: Id) {}

  equals(other?: Entity<Id>): boolean {
    if (other === undefined || other === null) return false;
    if (other.constructor !== this.constructor) return false;
    return JSON.stringify(this.id) === JSON.stringify(other.id);
  }
}

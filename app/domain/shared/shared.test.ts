import assert from "node:assert/strict";
import { test } from "node:test";
import { Entity, err, Guard, isErr, isOk, mapResult, ok, unwrapOr, ValueObject } from "./index";

test("Result ok/err and combinators", () => {
  assert.equal(isOk(ok(3)), true);
  assert.equal(isErr(err("bad")), true);
  assert.equal(unwrapOr(err<string>("x"), 7), 7);
  assert.equal(unwrapOr(ok(5), 7), 5);
  const mapped = mapResult(ok(2), n => n * 10);
  assert.deepEqual(mapped, ok(20));
});

test("Guard clauses", () => {
  assert.equal(isErr(Guard.againstNullOrUndefined(undefined, "x")), true);
  assert.equal(isOk(Guard.againstNullOrUndefined(0, "x")), true);
  assert.equal(isErr(Guard.againstEmpty("  ", "name")), true);
  assert.equal(isErr(Guard.inRange(5, 1, 3, "port")), true);
  assert.equal(isOk(Guard.oneOf("a", ["a", "b"] as const, "x")), true);
});

class Money extends ValueObject<{ amount: number; currency: string }> {
  static of(amount: number, currency: string) {
    return new Money({ amount, currency });
  }
}
class User extends Entity<string> {
  private constructor(
    id: string,
    readonly name: string,
  ) {
    super(id);
  }
  static of(id: string, name: string) {
    return new User(id, name);
  }
}

test("ValueObject compares by structure, Entity by identity", () => {
  assert.equal(Money.of(5, "USD").equals(Money.of(5, "USD")), true);
  assert.equal(Money.of(5, "USD").equals(Money.of(5, "EUR")), false);
  assert.equal(User.of("1", "a").equals(User.of("1", "b")), true); // same id, different attrs
  assert.equal(User.of("1", "a").equals(User.of("2", "a")), false);
});

test("equals rejects undefined and cross-type comparisons", () => {
  assert.equal(Money.of(5, "USD").equals(undefined), false);
  assert.equal(User.of("1", "a").equals(undefined), false);
  // A different Entity subclass with the same id is not equal.
  class Account extends Entity<string> {
    static of(id: string) {
      return new Account(id);
    }
  }
  assert.equal(User.of("1", "a").equals(Account.of("1") as never), false);
});

test("Guard.inRange treats min and max as inclusive", () => {
  assert.equal(isOk(Guard.inRange(1, 1, 3, "n")), true);
  assert.equal(isOk(Guard.inRange(3, 1, 3, "n")), true);
  assert.equal(isErr(Guard.inRange(0, 1, 3, "n")), true);
  assert.equal(isErr(Guard.inRange(4, 1, 3, "n")), true);
});

test("Guard.againstEmpty rejects empty and whitespace, accepts content", () => {
  assert.equal(isErr(Guard.againstEmpty("", "n")), true);
  assert.equal(isErr(Guard.againstEmpty("   ", "n")), true);
  assert.equal(isErr(Guard.againstEmpty(undefined, "n")), true);
  assert.equal(isOk(Guard.againstEmpty(" x ", "n")), true);
});

test("Guard.oneOf rejects values outside the set", () => {
  assert.equal(isErr(Guard.oneOf("c", ["a", "b"] as const, "n")), true);
});

// The guard messages are the whole output of a failed guard, and nothing read
// them back — so any text, including none, would have passed.
test("a failed guard says which field failed and why", () => {
  const required = Guard.againstNullOrUndefined(undefined, "name");
  assert.ok(isErr(required) && required.error === "name is required");

  // null is a separate branch from undefined and has to be caught too.
  const nulled = Guard.againstNullOrUndefined(null, "name");
  assert.ok(isErr(nulled) && nulled.error === "name is required");

  const range = Guard.inRange(11, 1, 10, "replicas");
  assert.ok(isErr(range) && range.error === "replicas must be between 1 and 10");

  // Two allowed values, so the separator is visible in the message.
  const choice = Guard.oneOf("Huge", ["Small", "Large"], "size");
  assert.ok(isErr(choice) && choice.error === "size must be one of Small, Large");
});

test("a value object is not equal to null, undefined, or another class", () => {
  class Metres extends ValueObject<{ n: number }> {
    static of(n: number) {
      return new Metres({ n });
    }
  }
  class Feet extends ValueObject<{ n: number }> {
    static of(n: number) {
      return new Feet({ n });
    }
  }
  const one = Metres.of(1);
  assert.equal(one.equals(Metres.of(1)), true);
  assert.equal(one.equals(undefined), false);
  assert.equal(one.equals(null as unknown as undefined), false);
  // Same props, different type: a length is not a length in another unit.
  assert.equal(one.equals(Feet.of(1)), false);
});

test("an entity is not equal to null, undefined, or another class with the same id", () => {
  class Order extends Entity<string> {
    static of(id: string) {
      return new Order(id);
    }
  }
  class Invoice extends Entity<string> {
    static of(id: string) {
      return new Invoice(id);
    }
  }
  const order = Order.of("1");
  assert.equal(order.equals(Order.of("1")), true);
  assert.equal(order.equals(undefined), false);
  assert.equal(order.equals(null as unknown as undefined), false);
  assert.equal(order.equals(Invoice.of("1")), false);
});

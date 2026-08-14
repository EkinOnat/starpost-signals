import { describe, expect, it } from "vitest";
import { formatAtomicAmount, parseAtomicAmount, stableJson } from "./impact";

describe("impact amounts", () => {
  it("round-trips atomic values without Number", () => {
    const atomic = parseAtomicAmount("123.4567890", 7);
    expect(atomic).toBe(1_234_567_890n);
    expect(formatAtomicAmount(atomic, 7)).toBe("123.456789");
  });

  it("rejects excess decimal precision", () => {
    expect(() => parseAtomicAmount("1.00000001", 7)).toThrow("TOO_MANY_DECIMALS");
  });
});

describe("canonical metadata", () => {
  it("sorts object keys recursively", () => {
    expect(stableJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{"a":{"b":3,"y":2},"z":1}',
    );
  });
});


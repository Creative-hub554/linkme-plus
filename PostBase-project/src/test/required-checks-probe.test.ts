import { describe, expect, it } from "vitest";

// A deliberate failure: this probe exists to show the required status checks block a merge.
describe("required-checks probe", () => {
  it("fails on purpose", () => {
    expect(1).toBe(2);
  });
});

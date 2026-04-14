import { describe, expect, it } from "vitest";
import { pickWaitlistSource } from "./waitlistSource";

describe("pickWaitlistSource", () => {
  it("prefers ref over utm params", () => {
    const q = new URLSearchParams("utm_source=x&ref=launch&ref=ignored");
    expect(pickWaitlistSource(q)).toBe("launch");
  });

  it("falls back to utm_campaign", () => {
    const q = new URLSearchParams("utm_campaign=spring");
    expect(pickWaitlistSource(q)).toBe("spring");
  });

  it("truncates to 64 chars", () => {
    const long = "a".repeat(80);
    const q = new URLSearchParams(`ref=${long}`);
    expect(pickWaitlistSource(q)?.length).toBe(64);
  });
});

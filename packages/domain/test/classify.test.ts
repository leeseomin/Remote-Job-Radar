import { describe, expect, it } from "vitest";
import { classifyJob } from "../src/classify";

describe("classifyJob", () => {
  it("scores a worldwide async graphics frontend role highly", () => {
    const result = classifyJob({
      title: "Frontend Engineer, Graphics",
      locationText: "Remote — Worldwide",
      descriptionText: `
        We are async-first with no core hours and default to written communication.
        Own a product from 0→1 using TypeScript, Three.js, WebGL and GLSL.
        Salary range: $120,000-$160,000.
      `,
    });

    expect(result.eligibleFromKorea).toBe("yes");
    expect(result.asyncLevel).toBe("explicit");
    expect(result.skills).toContain("Three.js");
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it("penalizes US-only synchronous roles", () => {
    const result = classifyJob({
      title: "Product Engineer",
      locationText: "Remote within the United States only",
      descriptionText: "Must overlap 5 hours with PST. Daily stand-up required.",
    });

    expect(result.eligibleFromKorea).toBe("no");
    expect(result.score).toBeLessThan(40);
  });
  it("lets explicit regional restrictions override broad global-team language", () => {
    const result = classifyJob({
      title: "Frontend Engineer",
      locationText: "Remote within the United States only",
      descriptionText: "Join our global remote team building WebGL products.",
    });

    expect(result.remoteScope).toBe("region-limited");
    expect(result.eligibleFromKorea).toBe("no");
  });

});

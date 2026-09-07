import { describe, it, expect } from "vitest";
import { generateXRayQuery } from "../src/services/x-ray-query-generator.service.js";
import type { XRaySearchCriteria } from "../src/types/discovery.js";
import { ProfileSource } from "@prisma/client";

describe("generateXRayQuery", () => {
  it("single role", () => {
    const result = generateXRayQuery({
      roles: ["Senior Engineer"],
      skills: ["TypeScript"],
      locations: ["India"],
    });
    expect(result).toBe('"Senior Engineer" TypeScript India');
  });

  it("multiple roles", () => {
    const result = generateXRayQuery({
      roles: ["PEB Designer", "Structural Designer"],
      skills: ["Tekla"],
      locations: ["India"],
    });
    expect(result).toBe(
      '("PEB Designer" OR "Structural Designer") Tekla India',
    );
  });

  it("multiple skills", () => {
    const result = generateXRayQuery({
      roles: ["Engineer"],
      skills: ["Tekla", "MBS"],
      locations: ["India"],
    });
    expect(result).toBe('Engineer ("Tekla" OR "MBS") India');
  });

  it("multiple locations", () => {
    const result = generateXRayQuery({
      roles: ["Engineer"],
      skills: ["Python"],
      locations: ["New York", "San Francisco"],
    });
    expect(result).toBe(
      'Engineer Python ("New York" OR "San Francisco")',
    );
  });

  it("companies", () => {
    const result = generateXRayQuery({
      roles: ["Engineer"],
      skills: ["Python"],
      locations: ["India"],
      companies: ["Acme Corp", "Globex"],
    });
    expect(result).toBe(
      'Engineer Python India ("Acme Corp" OR "Globex")',
    );
  });

  it("empty optional criteria", () => {
    const result = generateXRayQuery({
      roles: ["Engineer"],
      skills: ["Python"],
      locations: ["India"],
    });
    expect(result).toBe("Engineer Python India");
    expect(result).not.toContain("site:");
  });

  it("LinkedIn site restriction", () => {
    const result = generateXRayQuery({
      roles: ["Engineer"],
      skills: ["Python"],
      locations: ["India"],
      sources: [ProfileSource.LINKEDIN],
    });
    expect(result.startsWith("site:linkedin.com/in/")).toBe(true);
  });

  it("full example", () => {
    const result = generateXRayQuery({
      roles: ["PEB Designer", "Structural Designer"],
      skills: ["Tekla", "MBS"],
      locations: ["India"],
      sources: [ProfileSource.LINKEDIN],
    });
    expect(result).toBe(
      'site:linkedin.com/in/ ("PEB Designer" OR "Structural Designer") ("Tekla" OR "MBS") India',
    );
  });

  it("completely empty criteria returns empty string", () => {
    const result = generateXRayQuery({});
    expect(result).toBe("");
  });

  it("empty arrays are skipped", () => {
    const result = generateXRayQuery({
      roles: ["Engineer"],
      skills: [],
      locations: [],
      companies: [],
    });
    expect(result).toBe("Engineer");
  });

  it("whitespace-only strings are trimmed and dropped", () => {
    const result = generateXRayQuery({
      roles: ["  ", "Engineer"],
      skills: ["  "],
      locations: ["India"],
    });
    expect(result).toBe("Engineer India");
  });

  it("single role with spaces is quoted", () => {
    const result = generateXRayQuery({
      roles: ["Senior Engineer"],
    });
    expect(result).toBe('"Senior Engineer"');
  });

  it("multiple sites are wrapped in OR", () => {
    const result = generateXRayQuery({
      roles: ["Engineer"],
      sources: [ProfileSource.LINKEDIN, ProfileSource.GITHUB],
    });
    expect(result).toBe(
      "(site:linkedin.com/in/ OR site:github.com/) Engineer",
    );
  });
});

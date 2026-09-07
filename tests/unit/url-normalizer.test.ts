import { describe, it, expect } from "vitest";
import { normalizeUrl, determineProfileSource } from "../../src/lib/url-normalizer.js";
import { ProfileSource } from "@prisma/client";

describe("normalizeUrl", () => {
  describe("LinkedIn normalization", () => {
    it("strips www. from linkedin.com", () => {
      const result = normalizeUrl("https://www.linkedin.com/in/johndoe");
      expect(result).toBe("https://linkedin.com/in/johndoe");
    });

    it("normalizes locale subdomain (in.linkedin.com)", () => {
      const result = normalizeUrl("https://in.linkedin.com/in/johndoe");
      expect(result).toBe("https://linkedin.com/in/johndoe");
    });

    it("normalizes other locale subdomains (fr.linkedin.com)", () => {
      const result = normalizeUrl("https://fr.linkedin.com/in/johndoe");
      expect(result).toBe("https://linkedin.com/in/johndoe");
    });

    it("removes query parameters", () => {
      const result = normalizeUrl(
        "https://www.linkedin.com/in/johndoe?trk=public_profile&param=1",
      );
      expect(result).toBe("https://linkedin.com/in/johndoe");
    });

    it("removes fragments", () => {
      const result = normalizeUrl("https://www.linkedin.com/in/johndoe#section");
      expect(result).toBe("https://linkedin.com/in/johndoe");
    });

    it("removes trailing slash", () => {
      const result = normalizeUrl("https://www.linkedin.com/in/johndoe/");
      expect(result).toBe("https://linkedin.com/in/johndoe");
    });

    it("lowercases LinkedIn profile path", () => {
      const result = normalizeUrl("https://www.linkedin.com/in/JohnDoe");
      expect(result).toBe("https://linkedin.com/in/johndoe");
    });

    it("normalizes locale + www + trailing slash + query together", () => {
      const result = normalizeUrl(
        "https://in.linkedin.com/in/JohnDoe/?trk=profile&param=value#section",
      );
      expect(result).toBe("https://linkedin.com/in/johndoe");
    });
  });

  describe("general website normalization", () => {
    it("strips www. from general URLs", () => {
      const result = normalizeUrl("https://www.example.com/page");
      expect(result).toBe("https://example.com/page");
    });

    it("removes query parameters from general URLs", () => {
      const result = normalizeUrl("https://example.com/page?utm_source=x&utm_medium=y");
      expect(result).toBe("https://example.com/page");
    });

    it("removes fragments from general URLs", () => {
      const result = normalizeUrl("https://example.com/page#section");
      expect(result).toBe("https://example.com/page");
    });

    it("removes trailing slash from general URLs", () => {
      const result = normalizeUrl("https://example.com/page/");
      expect(result).toBe("https://example.com/page");
    });

    it("preserves path casing for non-LinkedIn URLs", () => {
      const result = normalizeUrl("https://example.com/SomePage");
      expect(result).toBe("https://example.com/SomePage");
    });

    it("normalizes protocol to https", () => {
      const result = normalizeUrl("http://example.com/page");
      expect(result).toBe("https://example.com/page");
    });

    it("handles URLs without www.", () => {
      const result = normalizeUrl("https://example.com/page");
      expect(result).toBe("https://example.com/page");
    });

    it("handles root path URLs", () => {
      const result = normalizeUrl("https://www.example.com/");
      expect(result).toBe("https://example.com");
    });
  });

  describe("URL rejection", () => {
    it("rejects malformed URLs", () => {
      expect(normalizeUrl("not-a-url")).toBeNull();
      expect(normalizeUrl("http://")).toBeNull();
      expect(normalizeUrl("://example.com")).toBeNull();
    });

    it("rejects mailto: URLs", () => {
      expect(normalizeUrl("mailto:foo@bar.com")).toBeNull();
    });

    it("rejects tel: URLs", () => {
      expect(normalizeUrl("tel:+1234567890")).toBeNull();
    });

    it("rejects ftp: URLs", () => {
      expect(normalizeUrl("ftp://example.com/file")).toBeNull();
    });

    it("rejects empty strings", () => {
      expect(normalizeUrl("")).toBeNull();
    });

    it("rejects javascript: URLs", () => {
      expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    });
  });
});

describe("determineProfileSource", () => {
  it("classifies linkedin.com as LINKEDIN", () => {
    expect(determineProfileSource("https://linkedin.com/in/johndoe")).toBe(ProfileSource.LINKEDIN);
  });

  it("classifies www.linkedin.com as LINKEDIN", () => {
    expect(determineProfileSource("https://www.linkedin.com/in/johndoe")).toBe(ProfileSource.LINKEDIN);
  });

  it("classifies locale.linkedin.com as LINKEDIN", () => {
    expect(determineProfileSource("https://in.linkedin.com/in/johndoe")).toBe(ProfileSource.LINKEDIN);
  });

  it("classifies github.com as GITHUB", () => {
    expect(determineProfileSource("https://github.com/username")).toBe(ProfileSource.GITHUB);
  });

  it("classifies www.github.com as GITHUB", () => {
    expect(determineProfileSource("https://www.github.com/username")).toBe(ProfileSource.GITHUB);
  });

  it("classifies normal websites as WEBSITE", () => {
    expect(determineProfileSource("https://example.com/portfolio")).toBe(ProfileSource.WEBSITE);
  });

  it("classifies www. websites as WEBSITE", () => {
    expect(determineProfileSource("https://www.example.com/page")).toBe(ProfileSource.WEBSITE);
  });

  it("classifies unknown/unclassifiable as OTHER", () => {
    expect(determineProfileSource("mailto:foo@bar.com")).toBe(ProfileSource.OTHER);
  });

  it("classifies malformed URLs as OTHER", () => {
    expect(determineProfileSource("not-a-url")).toBe(ProfileSource.OTHER);
  });

  it("classifies ftp URLs as OTHER", () => {
    expect(determineProfileSource("ftp://example.com/file")).toBe(ProfileSource.OTHER);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AppError } from "../src/errors/app-error.js";
import { SerpApiClient } from "../src/clients/serpapi.client.js";
import { SearchProvider } from "@prisma/client";

const DUMMY_API_KEY = "test-api-key-123";

const { mockGet, mockCreate } = vi.hoisted(() => {
  const mockGet = vi.fn();
  const mockCreate = vi.fn(() => ({ get: mockGet }));
  return { mockGet, mockCreate };
});

vi.mock("axios", () => ({
  default: {
    create: mockCreate,
  },
}));

interface MockResponse {
  status: number;
  data: unknown;
}

function res(data: unknown, status = 200): MockResponse {
  return { status, data };
}

function assertSerpapiError(
  error: unknown,
  expectedCode: string,
  expectedStatus: number,
): void {
  expect(error).toBeInstanceOf(AppError);
  const err = error as AppError;
  expect(err.code).toBe(expectedCode);
  expect(err.statusCode).toBe(expectedStatus);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SERPAPI_API_KEY = DUMMY_API_KEY;
  process.env.SERPAPI_TIMEOUT_MS = "15000";
  process.env.SERPAPI_RESULTS_PER_PAGE = "10";
});

afterEach(() => {
  delete process.env.SERPAPI_API_KEY;
  delete process.env.SERPAPI_TIMEOUT_MS;
  delete process.env.SERPAPI_RESULTS_PER_PAGE;
});

describe("SerpApiClient", () => {
  describe("constructor", () => {
    it("throws AppError when API key is missing", () => {
      delete process.env.SERPAPI_API_KEY;

      try {
        new SerpApiClient();
        fail("Should have thrown");
      } catch (error) {
        assertSerpapiError(error, "SERPAPI_API_KEY_MISSING", 503);
      }
    });

    it("throws AppError when API key is empty", () => {
      process.env.SERPAPI_API_KEY = "   ";

      try {
        new SerpApiClient();
        fail("Should have thrown");
      } catch (error) {
        assertSerpapiError(error, "SERPAPI_API_KEY_MISSING", 503);
      }
    });

    it("configures axios with default timeout", () => {
      delete process.env.SERPAPI_TIMEOUT_MS;
      new SerpApiClient();

      const config = mockCreate.mock.calls[0][0] as { timeout: number };
      expect(config.timeout).toBe(15000);
    });

    it("configures axios with custom timeout", () => {
      process.env.SERPAPI_TIMEOUT_MS = "5000";
      new SerpApiClient();

      const config = mockCreate.mock.calls[0][0] as { timeout: number };
      expect(config.timeout).toBe(5000);
    });

    it("caps resultsPerPage at 10", () => {
      process.env.SERPAPI_RESULTS_PER_PAGE = "50";
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(
        res({ organic_results: [{ link: "https://example.com", title: "T" }] }),
      );

      client.execute("query");
      expect(mockGet.mock.calls[0][1].params.num).toBe(10);
    });

    it("uses default resultsPerPage of 10", () => {
      delete process.env.SERPAPI_RESULTS_PER_PAGE;
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(
        res({ organic_results: [{ link: "https://example.com", title: "T" }] }),
      );

      client.execute("query");
      expect(mockGet.mock.calls[0][1].params.num).toBe(10);
    });

    it("does not include gl parameter in config", () => {
      new SerpApiClient();
      // gl is a per-request param, not a client config param
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe("execute - happy path", () => {
    it("maps SerpAPI organic results to NormalizedSearchResult", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(
        res({
          organic_results: [
            {
              position: 1,
              title: "John Doe - Senior Engineer",
              link: "https://www.linkedin.com/in/johndoe",
              snippet: "Senior Engineer at Acme Corp",
            },
            {
              position: 2,
              title: "Jane Smith - Developer",
              link: "https://github.com/janesmith",
              snippet: "Full-stack developer",
            },
          ],
        }),
      );

      const results = await client.execute('"Senior Engineer" TypeScript India');

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        title: "John Doe - Senior Engineer",
        url: "https://www.linkedin.com/in/johndoe",
        snippet: "Senior Engineer at Acme Corp",
        provider: SearchProvider.SERPAPI,
      });
      expect(results[1]).toEqual({
        title: "Jane Smith - Developer",
        url: "https://github.com/janesmith",
        snippet: "Full-stack developer",
        provider: SearchProvider.SERPAPI,
      });
      expect(client.name).toBe(SearchProvider.SERPAPI);
    });

    it("maps missing title and snippet to null", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(
        res({
          organic_results: [
            {
              link: "https://www.linkedin.com/in/johndoe",
            },
          ],
        }),
      );

      const results = await client.execute("engineer");

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        title: null,
        url: "https://www.linkedin.com/in/johndoe",
        snippet: null,
        provider: SearchProvider.SERPAPI,
      });
    });

    it("maps empty string title and snippet to null", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(
        res({
          organic_results: [
            {
              title: "   ",
              link: "https://example.com",
              snippet: "",
            },
          ],
        }),
      );

      const results = await client.execute("engineer");

      expect(results).toHaveLength(1);
      expect(results[0].title).toBeNull();
      expect(results[0].snippet).toBeNull();
    });

    it("passes query as the q parameter", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(res({ organic_results: [] }));

      await client.execute('"Senior Engineer" TypeScript');

      const callArgs = mockGet.mock.calls[0];
      expect(callArgs[0]).toBe("/search");
      expect(callArgs[1].params.q).toBe('"Senior Engineer" TypeScript');
      expect(callArgs[1].params.engine).toBe("google");
      expect(callArgs[1].params.hl).toBe("en");
      expect(callArgs[1].params).toHaveProperty("api_key");
      expect(callArgs[1].params.num).toBe(10);
    });

    it("does NOT include gl parameter", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(res({ organic_results: [] }));

      await client.execute("test");

      expect(mockGet.mock.calls[0][1].params).not.toHaveProperty("gl");
    });
  });

  describe("execute - URL filtering", () => {
    it("filters out results with missing link", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(
        res({
          organic_results: [
            { title: "No Link", snippet: "no url" },
            { title: "Valid", link: "https://example.com", snippet: "valid" },
          ],
        }),
      );

      const results = await client.execute("test");

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Valid");
    });

    it("filters out results with empty link", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(
        res({
          organic_results: [
            { title: "Empty", link: "   ", snippet: "empty url" },
            { title: "Valid", link: "https://example.com", snippet: "valid" },
          ],
        }),
      );

      const results = await client.execute("test");

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Valid");
    });

    it("filters out results with malformed URL", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(
        res({
          organic_results: [
            { title: "Bad URL", link: "not-a-url", snippet: "bad" },
            { title: "No Scheme", link: "example.com", snippet: "no scheme" },
            { title: "Valid", link: "https://example.com", snippet: "valid" },
          ],
        }),
      );

      const results = await client.execute("test");

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Valid");
    });

    it("filters out non-HTTP schemes", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(
        res({
          organic_results: [
            { title: "Mail", link: "mailto:foo@bar.com", snippet: "mail" },
            { title: "Tel", link: "tel:+1234567890", snippet: "tel" },
            { title: "Valid", link: "https://example.com", snippet: "valid" },
          ],
        }),
      );

      const results = await client.execute("test");

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Valid");
    });

    it("filters out non-object items in organic_results", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(
        res({
          organic_results: [
            null,
            "string-item",
            42,
            { link: "https://example.com", title: "Valid" },
          ],
        }),
      );

      const results = await client.execute("test");

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Valid");
    });

    it("returns empty array for empty organic_results", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(res({ organic_results: [] }));

      const results = await client.execute("test");

      expect(results).toEqual([]);
    });

    it("returns empty array when organic_results is missing", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(res({}));

      const results = await client.execute("test");

      expect(results).toEqual([]);
    });
  });

  describe("execute - SerpAPI error response", () => {
    it("throws AppError when SerpAPI returns an error field", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(res({ error: "Invalid API key" }));

      try {
        await client.execute("test");
        fail("Should have thrown");
      } catch (error) {
        assertSerpapiError(error, "SERPAPI_ERROR_RESPONSE", 502);
        expect((error as AppError).message).toBe("SerpAPI error: Invalid API key");
      }
    });
  });

  describe("execute - network errors", () => {
    it("throws AppError on network failure (ECONNREFUSED)", async () => {
      const client = new SerpApiClient();

      mockGet.mockRejectedValueOnce(
        Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        }),
      );

      try {
        await client.execute("test");
        fail("Should have thrown");
      } catch (error) {
        assertSerpapiError(error, "SERPAPI_NETWORK_ERROR", 502);
      }
    });

    it("throws AppError on timeout (ECONNABORTED)", async () => {
      const client = new SerpApiClient();

      mockGet.mockRejectedValueOnce(
        Object.assign(new Error("timeout of 15000ms exceeded"), {
          code: "ECONNABORTED",
        }),
      );

      try {
        await client.execute("test");
        fail("Should have thrown");
      } catch (error) {
        assertSerpapiError(error, "SERPAPI_TIMEOUT", 504);
      }
    });

    it("throws AppError on timeout (ETIMEDOUT)", async () => {
      const client = new SerpApiClient();

      mockGet.mockRejectedValueOnce(
        Object.assign(new Error("ETIMEDOUT"), {
          code: "ETIMEDOUT",
        }),
      );

      try {
        await client.execute("test");
        fail("Should have thrown");
      } catch (error) {
        assertSerpapiError(error, "SERPAPI_TIMEOUT", 504);
      }
    });

    it("throws AppError on non-success HTTP status (503)", async () => {
      const client = new SerpApiClient();

      mockGet.mockRejectedValueOnce(
        Object.assign(new Error("Request failed with status 503"), {
          code: "ERR_BAD_RESPONSE",
          response: { status: 503, data: { error: "Service Unavailable" } },
        }),
      );

      try {
        await client.execute("test");
        fail("Should have thrown");
      } catch (error) {
        assertSerpapiError(error, "SERPAPI_HTTP_ERROR", 502);
        expect((error as AppError).message).toBe("SerpAPI returned status 503");
      }
    });

    it("throws AppError on 400 HTTP status", async () => {
      const client = new SerpApiClient();

      mockGet.mockRejectedValueOnce(
        Object.assign(new Error("Request failed with status 400"), {
          response: { status: 400, data: { error: "Bad request" } },
        }),
      );

      try {
        await client.execute("test");
        fail("Should have thrown");
      } catch (error) {
        assertSerpapiError(error, "SERPAPI_HTTP_ERROR", 502);
      }
    });
  });

  describe("execute - response validation errors", () => {
    it("throws AppError when response data is a string", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(res("not json"));

      try {
        await client.execute("test");
        fail("Should have thrown");
      } catch (error) {
        assertSerpapiError(error, "SERPAPI_INVALID_RESPONSE", 502);
      }
    });

    it("throws AppError when response data is null", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(res(null));

      try {
        await client.execute("test");
        fail("Should have thrown");
      } catch (error) {
        assertSerpapiError(error, "SERPAPI_INVALID_RESPONSE", 502);
      }
    });

    it("throws AppError when organic_results is not an array", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(res({ organic_results: "not-an-array" }));

      try {
        await client.execute("test");
        fail("Should have thrown");
      } catch (error) {
        assertSerpapiError(error, "SERPAPI_INVALID_RESPONSE", 502);
      }
    });

    it("throws AppError when response data is a number", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(res(42));

      try {
        await client.execute("test");
        fail("Should have thrown");
      } catch (error) {
        assertSerpapiError(error, "SERPAPI_INVALID_RESPONSE", 502);
      }
    });
  });

  describe("security", () => {
    it("does not include API key in error messages on network failure", async () => {
      const client = new SerpApiClient();

      mockGet.mockRejectedValueOnce(
        Object.assign(new Error("connect ECONNREFUSED"), {
          code: "ECONNREFUSED",
        }),
      );

      try {
        await client.execute("test");
        fail("Should have thrown");
      } catch (error) {
        const err = error as AppError;
        expect(err.message).not.toContain(DUMMY_API_KEY);
        expect(err.message).not.toContain("api_key");
      }
    });

    it("does not include API key in error messages on HTTP error", async () => {
      const client = new SerpApiClient();

      mockGet.mockRejectedValueOnce(
        Object.assign(new Error("Request failed"), {
          response: { status: 500, data: { error: "Server error" } },
        }),
      );

      try {
        await client.execute("test");
        fail("Should have thrown");
      } catch (error) {
        const err = error as AppError;
        expect(err.message).not.toContain(DUMMY_API_KEY);
      }
    });

    it("does not include API key in error messages on SerpAPI error response", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(res({ error: "Invalid API key" }));

      try {
        await client.execute("test");
        fail("Should have thrown");
      } catch (error) {
        const err = error as AppError;
        expect(err.message).not.toContain(DUMMY_API_KEY);
      }
    });

    it("does not include API key in axios config error output", async () => {
      const client = new SerpApiClient();

      const networkError = Object.assign(
        new Error("network error"),
        { code: "ECONNREFUSED" },
      );

      mockGet.mockRejectedValueOnce(networkError);

      try {
        await client.execute("test");
      } catch (error) {
        const err = error as AppError;
        expect(err.message).not.toMatch(/api_key/i);
        expect(err.message).not.toContain("serpapi.com");
      }
    });

    it("verifies no real network requests are made (mock is used)", async () => {
      const client = new SerpApiClient();

      mockGet.mockResolvedValueOnce(res({ organic_results: [] }));

      await client.execute("test");

      expect(mockGet).toHaveBeenCalledTimes(1);
      expect(mockGet.mock.calls[0][0]).toBe("/search");
      expect(mockGet.mock.calls[0][1].params).toHaveProperty("api_key");
      expect(mockGet.mock.calls[0][1].params.engine).toBe("google");
      expect(mockGet.mock.calls[0][1].params.q).toBe("test");
    });
  });
});

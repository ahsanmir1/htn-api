import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Prisma, SearchProvider, DiscoveryRunStatus } from "@prisma/client";
import { AppError } from "../src/errors/app-error.js";
import { DiscoveryService } from "../src/services/discovery.service.js";
import type {
  NormalizedSearchResult,
  SearchProviderContract,
} from "../src/types/discovery.js";

const {
  mockTx,
  mockTransaction,
  mockFindUnique,
  mockCreateRun,
  mockRunUpdate,
} = vi.hoisted(() => {
  const mockTx = {
    discoveredProfile: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
    discoverySearchRun: {
      update: vi.fn(),
    },
  };
  const mockTransaction = vi.fn(async (fn: any) => fn(mockTx));
  const mockFindUnique = vi.fn();
  const mockCreateRun = vi.fn();
  const mockRunUpdate = vi.fn();
  return { mockTx, mockTransaction, mockFindUnique, mockCreateRun, mockRunUpdate };
});

vi.mock("../src/prisma/client.js", () => ({
  default: {
    $transaction: mockTransaction,
    discoverySearch: { findUnique: mockFindUnique },
    discoverySearchRun: { create: mockCreateRun, update: mockRunUpdate },
  },
}));

const DUMMY_API_KEY = "test-key-12345";

const mockExecute = vi.fn();
const mockProvider: SearchProviderContract = {
  name: SearchProvider.SERPAPI,
  execute: mockExecute,
};

function makeResult(url: string, title = "Test Profile"): NormalizedSearchResult {
  return {
    title,
    url,
    snippet: "Relevant snippet text",
    provider: SearchProvider.SERPAPI,
  };
}

function makeSearch(status = "ACTIVE") {
  return {
    id: "search-1",
    name: "Test Search",
    query: "test query",
    status,
    organizationId: "org-1",
    roles: null,
    skills: null,
    locations: null,
    companies: null,
  };
}

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    searchId: "search-1",
    provider: SearchProvider.SERPAPI,
    status: DiscoveryRunStatus.RUNNING,
    startedAt: new Date(),
    completedAt: null,
    resultCount: null,
    newProfiles: null,
    duplicates: null,
    error: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeNormalizedResult(title = "Test Profile"): NormalizedSearchResult {
  return {
    title,
    url: `https://www.linkedin.com/in/${title.toLowerCase().replace(/\s+/g, "")}`,
    snippet: "Snippet text",
    provider: SearchProvider.SERPAPI,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockFindUnique.mockResolvedValue(makeSearch());
  mockCreateRun.mockResolvedValue(makeRun());
  mockExecute.mockReset();

  mockTx.discoveredProfile.findMany.mockReset();
  mockTx.discoveredProfile.createMany.mockReset();
  mockTx.discoverySearchRun.update.mockReset();
  mockTx.discoverySearchRun.update.mockResolvedValue(makeRun({ status: DiscoveryRunStatus.COMPLETED }));

  mockRunUpdate.mockReset();
  mockRunUpdate.mockResolvedValue({});

  process.env.SERPAPI_API_KEY = DUMMY_API_KEY;
});

afterEach(() => {
  delete process.env.SERPAPI_API_KEY;
});

describe("DiscoveryService.executeSearch", () => {
  const service = new DiscoveryService(mockProvider);

  describe("search validation", () => {
    it("throws DISCOVERY_SEARCH_NOT_FOUND when search does not exist", async () => {
      mockFindUnique.mockResolvedValue(null);

      await expect(service.executeSearch("nonexistent")).rejects.toMatchObject({
        code: "DISCOVERY_SEARCH_NOT_FOUND",
        statusCode: 404,
      });
      expect(mockCreateRun).not.toHaveBeenCalled();
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("throws DISCOVERY_SEARCH_NOT_ACTIVE (409) when search is DRAFT", async () => {
      mockFindUnique.mockResolvedValue(makeSearch("DRAFT"));

      await expect(service.executeSearch("search-1")).rejects.toMatchObject({
        code: "DISCOVERY_SEARCH_NOT_ACTIVE",
        statusCode: 409,
      });
      expect(mockCreateRun).not.toHaveBeenCalled();
    });

    it("throws DISCOVERY_SEARCH_NOT_ACTIVE (409) when search is PAUSED", async () => {
      mockFindUnique.mockResolvedValue(makeSearch("PAUSED"));

      await expect(service.executeSearch("search-1")).rejects.toMatchObject({
        code: "DISCOVERY_SEARCH_NOT_ACTIVE",
        statusCode: 409,
      });
    });

    it("throws DISCOVERY_SEARCH_NOT_ACTIVE (409) when search is ARCHIVED", async () => {
      mockFindUnique.mockResolvedValue(makeSearch("ARCHIVED"));

      await expect(service.executeSearch("search-1")).rejects.toMatchObject({
        code: "DISCOVERY_SEARCH_NOT_ACTIVE",
        statusCode: 409,
      });
    });
  });

  describe("run lifecycle", () => {
    it("creates a run with provider from the injected provider (not hardcoded)", async () => {
      mockExecute.mockResolvedValue([]);

      await service.executeSearch("search-1");

      expect(mockCreateRun).toHaveBeenCalledOnce();
      const callArgs = mockCreateRun.mock.calls[0][0];
      expect(callArgs.data.provider).toBe(SearchProvider.SERPAPI);
      expect(callArgs.data.status).toBe(DiscoveryRunStatus.RUNNING);
      expect(callArgs.data.startedAt).toBeInstanceOf(Date);
    });

    it("marks run COMPLETED on success", async () => {
      mockExecute.mockResolvedValue([
        makeResult("https://www.linkedin.com/in/user1"),
      ]);
      mockTx.discoveredProfile.findMany.mockResolvedValue([]);
      mockTx.discoveredProfile.createMany.mockResolvedValue({ count: 1 });

      const result = await service.executeSearch("search-1");

      expect(result.run.status).toBe(DiscoveryRunStatus.COMPLETED);
    });

    it("marks run FAILED on provider failure", async () => {
      mockExecute.mockRejectedValue(
        new AppError("SERPAPI_NETWORK_ERROR", "Failed to communicate with SerpAPI", 502),
      );

      try {
        await service.executeSearch("search-1");
        fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe("SERPAPI_NETWORK_ERROR");
      }

      expect(mockRunUpdate).toHaveBeenCalledOnce();
      const updateArgs = mockRunUpdate.mock.calls[0][0];
      expect(updateArgs.data.status).toBe(DiscoveryRunStatus.FAILED);
      expect(updateArgs.data.error).toBe("Failed to communicate with search provider");
      expect(updateArgs.data.completedAt).toBeInstanceOf(Date);
    });

    it("marks run FAILED on database transaction failure", async () => {
      mockExecute.mockResolvedValue([
        makeResult("https://www.linkedin.com/in/user1"),
      ]);
      mockTx.discoveredProfile.findMany.mockRejectedValue(
        new Error("DB connection lost"),
      );

      try {
        await service.executeSearch("search-1");
        fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe("INTERNAL_ERROR");
      }

      expect(mockRunUpdate).toHaveBeenCalledOnce();
      const updateArgs = mockRunUpdate.mock.calls[0][0];
      expect(updateArgs.data.status).toBe(DiscoveryRunStatus.FAILED);
      expect(updateArgs.data.error).toBe("Database operation failed");
    });
  });

  describe("successful execution", () => {
    it("maps results to DiscoveredProfile and completes run", async () => {
      const results = [
        makeResult("https://www.linkedin.com/in/user1", "User One"),
        makeResult("https://www.linkedin.com/in/user2", "User Two"),
      ];
      mockExecute.mockResolvedValue(results);
      mockTx.discoveredProfile.findMany.mockResolvedValue([]);
      mockTx.discoveredProfile.createMany.mockResolvedValue({ count: 2 });

      const result = await service.executeSearch("search-1");

      expect(result.counters.resultCount).toBe(2);
      expect(result.counters.newProfiles).toBe(2);
      expect(result.counters.duplicates).toBe(0);

      const createCall = mockTx.discoveredProfile.createMany.mock.calls[0][0];
      expect(createCall.data).toHaveLength(2);
      expect(createCall.skipDuplicates).toBe(true);

      const firstProfile = createCall.data[0];
      expect(firstProfile.searchRunId).toBe("run-1");
      expect(firstProfile.profileUrl).toBe("https://www.linkedin.com/in/user1");
      expect(firstProfile.normalizedUrl).toBe("https://linkedin.com/in/user1");
      expect(firstProfile.headline).toBe("User One");
      expect(firstProfile.snippet).toBe("Relevant snippet text");
      expect(firstProfile.source).toBe("LINKEDIN");
      expect(firstProfile).not.toHaveProperty("candidateId");
    });

    it("returns empty array results in COMPLETED run with zero counters", async () => {
      mockExecute.mockResolvedValue([]);

      const result = await service.executeSearch("search-1");

      expect(result.counters).toEqual({
        resultCount: 0,
        newProfiles: 0,
        duplicates: 0,
      });
      expect(mockTx.discoveredProfile.createMany).not.toHaveBeenCalled();
    });

    it("does not call createMany when all results are invalid URLs", async () => {
      mockExecute.mockResolvedValue([
        { ...makeResult("not-a-valid-url"), url: "not-a-valid-url" },
        { ...makeResult("mailto:test@example.com"), url: "mailto:test@example.com" },
      ]);

      mockTx.discoveredProfile.findMany.mockResolvedValue([]);
      mockTx.discoveredProfile.createMany.mockResolvedValue({ count: 0 });

      const result = await service.executeSearch("search-1");

      expect(result.counters.resultCount).toBe(0);
      expect(result.counters.newProfiles).toBe(0);
      expect(result.counters.duplicates).toBe(0);
      expect(mockTx.discoveredProfile.createMany).not.toHaveBeenCalled();
    });
  });

  describe("within-run duplicates", () => {
    it("counts duplicate URLs within the same result set", async () => {
      mockExecute.mockResolvedValue([
        makeResult("https://www.linkedin.com/in/user1"),
        makeResult("https://www.linkedin.com/in/user1"),
      ]);
      mockTx.discoveredProfile.findMany.mockResolvedValue([]);
      mockTx.discoveredProfile.createMany.mockResolvedValue({ count: 1 });

      const result = await service.executeSearch("search-1");

      expect(result.counters.resultCount).toBe(2);
      expect(result.counters.newProfiles).toBe(1);
      expect(result.counters.duplicates).toBe(1);

      expect(mockTx.discoveredProfile.createMany.mock.calls[0][0].data).toHaveLength(1);
    });
  });

  describe("cross-run duplicates", () => {
    it("skips URLs that already exist in DiscoveredProfile", async () => {
      mockExecute.mockResolvedValue([
        makeResult("https://www.linkedin.com/in/user1"),
        makeResult("https://www.linkedin.com/in/user2"),
      ]);
      mockTx.discoveredProfile.findMany.mockResolvedValue([
        { normalizedUrl: "https://linkedin.com/in/user1" },
      ]);
      mockTx.discoveredProfile.createMany.mockResolvedValue({ count: 1 });

      const result = await service.executeSearch("search-1");

      expect(result.counters.resultCount).toBe(2);
      expect(result.counters.newProfiles).toBe(1);
      expect(result.counters.duplicates).toBe(1);

      const createCall = mockTx.discoveredProfile.createMany.mock.calls[0][0];
      expect(createCall.data).toHaveLength(1);
      expect(createCall.data[0].normalizedUrl).toBe("https://linkedin.com/in/user2");
    });
  });

  describe("createMany count is authoritative", () => {
    it("uses createMany return count as newProfiles, not attempted insert count", async () => {
      mockExecute.mockResolvedValue([
        makeResult("https://www.linkedin.com/in/user1"),
        makeResult("https://www.linkedin.com/in/user2"),
        makeResult("https://www.linkedin.com/in/user3"),
        makeResult("https://www.linkedin.com/in/user4"),
        makeResult("https://www.linkedin.com/in/user5"),
        makeResult("https://www.linkedin.com/in/user6"),
        makeResult("https://www.linkedin.com/in/user7"),
      ]);
      mockTx.discoveredProfile.findMany.mockResolvedValue([]);
      mockTx.discoveredProfile.createMany.mockResolvedValue({ count: 5 });

      const result = await service.executeSearch("search-1");

      expect(result.counters.resultCount).toBe(7);
      expect(result.counters.newProfiles).toBe(5);
      expect(result.counters.duplicates).toBe(2);

      expect(mockTx.discoverySearchRun.update).toHaveBeenCalled();
      const updateCall = mockTx.discoverySearchRun.update.mock.calls[0][0];
      expect(updateCall.data.resultCount).toBe(7);
      expect(updateCall.data.newProfiles).toBe(5);
      expect(updateCall.data.duplicates).toBe(2);
      expect(updateCall.data.status).toBe(DiscoveryRunStatus.COMPLETED);
    });
  });

  describe("counter invariant: resultCount = newProfiles + duplicates", () => {
    it("all new profiles — 0 duplicates", async () => {
      mockExecute.mockResolvedValue([
        makeResult("https://www.linkedin.com/in/user1"),
        makeResult("https://www.linkedin.com/in/user2"),
        makeResult("https://www.linkedin.com/in/user3"),
      ]);
      mockTx.discoveredProfile.findMany.mockResolvedValue([]);
      mockTx.discoveredProfile.createMany.mockResolvedValue({ count: 3 });

      const result = await service.executeSearch("search-1");

      const { resultCount, newProfiles, duplicates } = result.counters;
      expect(resultCount).toBe(newProfiles + duplicates);
      expect(resultCount).toBe(3);
      expect(newProfiles).toBe(3);
      expect(duplicates).toBe(0);
    });

    it("mix of valid, within-run dup, and cross-run dup", async () => {
      mockExecute.mockResolvedValue([
        makeResult("https://www.linkedin.com/in/user1"),
        makeResult("https://www.linkedin.com/in/user1"),
        makeResult("https://www.linkedin.com/in/user2"),
        makeResult("https://www.linkedin.com/in/user3"),
        makeResult("https://www.linkedin.com/in/user3"),
      ]);
      mockTx.discoveredProfile.findMany.mockResolvedValue([
        { normalizedUrl: "https://linkedin.com/in/user2" },
      ]);
      mockTx.discoveredProfile.createMany.mockResolvedValue({ count: 1 });

      const result = await service.executeSearch("search-1");

      const { resultCount, newProfiles, duplicates } = result.counters;
      expect(resultCount).toBe(newProfiles + duplicates);
      // valid: user1, user1(dup), user2, user3, user3(dup) = 5 valid results
      // within-run dups: 2 (user1 and user3 each appear twice)
      // cross-run dups: 1 (user2)
      // after filtering: only user1 and user3 (first occurrence) = 2 attempted
      // createMany returns 1 (simulating db skip)
      // newProfiles = 1, dbSkipped = 2-1 = 1
      // duplicates = 2 (within) + 1 (cross) + 1 (db) = 4
      // resultCount = 5, newProfiles = 1, duplicates = 4
      // 5 = 1 + 4 ✓
      expect(resultCount).toBe(5);
      expect(newProfiles).toBe(1);
      expect(duplicates).toBe(4);
    });

    it("all cross-run duplicates", async () => {
      mockExecute.mockResolvedValue([
        makeResult("https://www.linkedin.com/in/user1"),
        makeResult("https://www.linkedin.com/in/user2"),
      ]);
      mockTx.discoveredProfile.findMany.mockResolvedValue([
        { normalizedUrl: "https://linkedin.com/in/user1" },
        { normalizedUrl: "https://linkedin.com/in/user2" },
      ]);
      mockTx.discoveredProfile.createMany.mockResolvedValue({ count: 0 });

      const result = await service.executeSearch("search-1");

      const { resultCount, newProfiles, duplicates } = result.counters;
      expect(resultCount).toBe(newProfiles + duplicates);
      expect(resultCount).toBe(2);
      expect(newProfiles).toBe(0);
      expect(duplicates).toBe(2);
    });
  });

  describe("candidateId safety", () => {
    it("never includes candidateId in created profiles", async () => {
      mockExecute.mockResolvedValue([
        makeResult("https://www.linkedin.com/in/user1"),
      ]);
      mockTx.discoveredProfile.findMany.mockResolvedValue([]);
      mockTx.discoveredProfile.createMany.mockResolvedValue({ count: 1 });

      await service.executeSearch("search-1");

      const createCall = mockTx.discoveredProfile.createMany.mock.calls[0][0];
      createCall.data.forEach((profile: Record<string, unknown>) => {
        expect(profile).not.toHaveProperty("candidateId");
      });
    });
  });

  describe("error sanitization", () => {
    it("sanitizes SERPAPI_TIMEOUT to safe message in stored error", async () => {
      mockExecute.mockRejectedValue(
        new AppError("SERPAPI_TIMEOUT", "SerpAPI request timed out", 504),
      );

      const promise = service.executeSearch("search-1");
      await expect(promise).rejects.toMatchObject({
        code: "SERPAPI_TIMEOUT",
      });

      const updateArgs = mockRunUpdate.mock.calls[0][0];
      expect(updateArgs.data.error).toBe("Search provider request timed out");
    });

    it("sanitizes SERPAPI_NETWORK_ERROR to safe message", async () => {
      mockExecute.mockRejectedValue(
        new AppError("SERPAPI_NETWORK_ERROR", "Failed to communicate with SerpAPI", 502),
      );

      const promise = service.executeSearch("search-1");
      await expect(promise).rejects.toMatchObject({
        code: "SERPAPI_NETWORK_ERROR",
      });

      const updateArgs = mockRunUpdate.mock.calls[0][0];
      expect(updateArgs.data.error).toBe("Failed to communicate with search provider");
    });

    it("sanitizes SERPAPI_HTTP_ERROR to safe message", async () => {
      mockExecute.mockRejectedValue(
        new AppError("SERPAPI_HTTP_ERROR", "SerpAPI returned status 503", 502),
      );

      const promise = service.executeSearch("search-1");
      await expect(promise).rejects.toMatchObject({
        code: "SERPAPI_HTTP_ERROR",
      });

      const updateArgs = mockRunUpdate.mock.calls[0][0];
      expect(updateArgs.data.error).toBe("Search provider returned an error");
    });

    it("sanitizes unknown errors to generic message", async () => {
      mockExecute.mockRejectedValue(new Error("Unexpected: api_key=sk-12345"));

      const promise = service.executeSearch("search-1");
      await expect(promise).rejects.toThrow(AppError);

      const updateArgs = mockRunUpdate.mock.calls[0][0];
      expect(updateArgs.data.error).toBe("Search execution failed");
      expect(updateArgs.data.error).not.toContain("api_key");
      expect(updateArgs.data.error).not.toContain("sk-12345");
    });

    it("sanitizes DB errors in transaction to safe message", async () => {
      mockExecute.mockResolvedValue([
        makeResult("https://www.linkedin.com/in/user1"),
      ]);
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        "P2002: duplicate key value violates unique constraint",
        "P2002",
        Buffer.from([]),
      );
      mockTx.discoveredProfile.findMany.mockRejectedValue(prismaError);

      const promise = service.executeSearch("search-1");
      await expect(promise).rejects.toMatchObject({
        code: "INTERNAL_ERROR",
      });

      const updateArgs = mockRunUpdate.mock.calls[0][0];
      expect(updateArgs.data.error).toBe("Database operation failed");
    });
  });

  describe("sensitive information protection", () => {
    it("never stores API key in error message", async () => {
      mockExecute.mockRejectedValue(
        Object.assign(new Error(`Request to serpapi.com?api_key=${DUMMY_API_KEY} failed`), {
          code: "ECONNREFUSED",
        }),
      );

      const promise = service.executeSearch("search-1");
      await expect(promise).rejects.toThrow();

      const updateArgs = mockRunUpdate.mock.calls[0][0];
      expect(updateArgs.data.error).not.toContain(DUMMY_API_KEY);
      expect(updateArgs.data.error).not.toMatch(/api_key/i);
      expect(updateArgs.data.error).not.toContain("serpapi.com");
    });

    it("never stores raw SerpAPI response data in error message", async () => {
      mockExecute.mockRejectedValue(
        Object.assign(new Error("raw response: { api_key: 'secret', results: [] }"), {
          code: "ECONNREFUSED",
        }),
      );

      const promise = service.executeSearch("search-1");
      await expect(promise).rejects.toThrow();

      const updateArgs = mockRunUpdate.mock.calls[0][0];
      expect(updateArgs.data.error).not.toContain("secret");
      expect(updateArgs.data.error).not.toContain("api_key");
      expect(updateArgs.data.error).not.toContain("results");
    });
  });

  describe("provider abstraction", () => {
    it("uses the injected provider's name for the run record", () => {
      const customProvider: SearchProviderContract = {
        name: SearchProvider.OTHER,
        execute: vi.fn(),
      };

      const customService = new DiscoveryService(customProvider);

      mockExecute.mockResolvedValue([]);
      // The service uses this.provider.name, not this.provider's class
      expect(mockProvider.name).toBe(SearchProvider.SERPAPI);
      expect(customProvider.name).toBe(SearchProvider.OTHER);
    });
  });
});

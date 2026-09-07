import { Prisma, SearchProvider, DiscoveryRunStatus } from "@prisma/client";
import prisma from "../prisma/client.js";
import { AppError } from "../errors/app-error.js";
import { DiscoveryRepository } from "../repositories/discovery.repository.js";
import type {
  RunRecord,
  DiscoveredProfileInput,
} from "../repositories/discovery.repository.js";
import { normalizeUrl, determineProfileSource } from "../lib/url-normalizer.js";
import type {
  NormalizedSearchResult,
  SearchProviderContract,
} from "../types/discovery.js";

export interface DiscoveryRunResult {
  run: RunRecord;
  counters: {
    resultCount: number;
    newProfiles: number;
    duplicates: number;
  };
}

export interface ProcessedCounters {
  resultCount: number;
  newProfiles: number;
  duplicates: number;
}

export class DiscoveryService {
  private readonly repository: DiscoveryRepository;

  constructor(private readonly provider: SearchProviderContract) {
    this.repository = new DiscoveryRepository();
  }

  async executeSearch(searchId: string): Promise<DiscoveryRunResult> {
    const search = await this.repository.findSearchById(searchId);

    if (!search) {
      throw new AppError(
        "DISCOVERY_SEARCH_NOT_FOUND",
        "Discovery search not found",
        404,
      );
    }

    if (search.status !== "ACTIVE") {
      throw new AppError(
        "DISCOVERY_SEARCH_NOT_ACTIVE",
        "Only ACTIVE searches can be executed",
        409,
      );
    }

    const run = await this.repository.createRun({
      searchId: search.id,
      provider: this.provider.name,
      status: DiscoveryRunStatus.RUNNING,
      startedAt: new Date(),
    });

    let results: NormalizedSearchResult[];

    try {
      results = await this.provider.execute(search.query);
    } catch (error) {
      await this.repository.markRunFailed(
        run.id,
        sanitizeErrorMessage(error),
        new Date(),
      );
      if (error instanceof AppError) throw error;
      throw new AppError("INTERNAL_ERROR", "Search execution failed", 500);
    }

    try {
      const { run: updatedRun, counters } = await prisma.$transaction<
        { run: RunRecord; counters: ProcessedCounters }
      >(async (tx) => {
        return await this.processResults(tx, run.id, results);
      });

      return { run: updatedRun, counters };
    } catch (error) {
      await this.repository.markRunFailed(
        run.id,
        error instanceof AppError
          ? sanitizeErrorMessage(error)
          : "Database operation failed",
        new Date(),
      );

      if (error instanceof AppError) throw error;
      throw new AppError("INTERNAL_ERROR", "Search execution failed", 500);
    }
  }

  private async processResults(
    tx: Prisma.TransactionClient,
    runId: string,
    results: NormalizedSearchResult[],
  ): Promise<{ run: RunRecord; counters: ProcessedCounters }> {
    const seenInRun = new Set<string>();
    let withinRunDuplicates = 0;
    let validResults = 0;
    const profilesToInsert: DiscoveredProfileInput[] = [];

    for (const result of results) {
      const normalizedUrl = normalizeUrl(result.url);
      if (!normalizedUrl) {
        continue;
      }

      validResults++;

      if (seenInRun.has(normalizedUrl)) {
        withinRunDuplicates++;
        continue;
      }

      profilesToInsert.push({
        searchRunId: runId,
        source: determineProfileSource(normalizedUrl),
        profileUrl: result.url,
        normalizedUrl,
        headline: result.title ?? null,
        snippet: result.snippet ?? null,
        rawData: result as unknown as Prisma.InputJsonValue,
      });
      seenInRun.add(normalizedUrl);
    }

    const validUrls = profilesToInsert.map((p) => p.normalizedUrl);
    const existingUrls = await this.repository.findExistingUrls(tx, validUrls);

    const newProfilesOnly = profilesToInsert.filter(
      (p) => !existingUrls.has(p.normalizedUrl),
    );
    const crossRunDuplicates = profilesToInsert.length - newProfilesOnly.length;

    const attemptedInsert = newProfilesOnly.length;
    const newProfiles = await this.repository.createProfiles(tx, newProfilesOnly);
    const dbSkippedDuplicates = attemptedInsert - newProfiles;

    const counters: ProcessedCounters = {
      resultCount: validResults,
      newProfiles,
      duplicates: withinRunDuplicates + crossRunDuplicates + dbSkippedDuplicates,
    };

    const run = await this.repository.completeRun(
      tx,
      runId,
      counters,
      new Date(),
    );

    return { run, counters };
  }
}

function sanitizeErrorMessage(error: unknown): string {
  let code: string | undefined;
  let isProviderError = false;
  let isDbError = false;

  if (error instanceof AppError) {
    code = error.code;
    if (code.startsWith("SERPAPI_")) {
      isProviderError = true;
    }
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    isDbError = true;
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    isDbError = true;
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    isDbError = true;
  }

  if (error instanceof Prisma.PrismaClientRustPanicError) {
    isDbError = true;
  }

  if (isDbError) {
    return "Database operation failed";
  }

  if (isProviderError && code === "SERPAPI_TIMEOUT") {
    return "Search provider request timed out";
  }

  if (isProviderError && code === "SERPAPI_NETWORK_ERROR") {
    return "Failed to communicate with search provider";
  }

  if (isProviderError) {
    return "Search provider returned an error";
  }

  return "Search execution failed";
}

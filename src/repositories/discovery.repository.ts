import { Prisma, SearchProvider, DiscoveryRunStatus } from "@prisma/client";
import prisma from "../prisma/client.js";
import type { DiscoveredProfileStatus, ProfileSource } from "@prisma/client";

type Client = Prisma.TransactionClient;

export interface CreateRunInput {
  searchId: string;
  provider: SearchProvider;
  status: DiscoveryRunStatus;
  startedAt: Date;
}

export interface RunCounters {
  resultCount: number;
  newProfiles: number;
  duplicates: number;
}

export interface DiscoveredProfileInput {
  searchRunId: string;
  source: ProfileSource;
  profileUrl: string;
  normalizedUrl: string;
  headline?: string | null;
  snippet?: string | null;
  rawData: Prisma.InputJsonValue;
}

export interface SearchRecord {
  id: string;
  name: string;
  query: string;
  roles: unknown;
  skills: unknown;
  locations: unknown;
  companies: unknown;
  status: string;
  organizationId: string;
}

export interface RunRecord {
  id: string;
  searchId: string;
  provider: SearchProvider;
  status: DiscoveryRunStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  resultCount: number | null;
  newProfiles: number | null;
  duplicates: number | null;
  error: string | null;
  createdAt: Date;
}

export class DiscoveryRepository {
  async findSearchById(id: string): Promise<SearchRecord | null> {
    return prisma.discoverySearch.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        query: true,
        roles: true,
        skills: true,
        locations: true,
        companies: true,
        status: true,
        organizationId: true,
      },
    });
  }

  async createRun(data: CreateRunInput): Promise<RunRecord> {
    return prisma.discoverySearchRun.create({
      data: {
        searchId: data.searchId,
        provider: data.provider,
        status: data.status,
        startedAt: data.startedAt,
      },
      select: {
        id: true,
        searchId: true,
        provider: true,
        status: true,
        startedAt: true,
        completedAt: true,
        resultCount: true,
        newProfiles: true,
        duplicates: true,
        error: true,
        createdAt: true,
      },
    });
  }

  async markRunFailed(
    runId: string,
    error: string,
    completedAt: Date,
  ): Promise<void> {
    await prisma.discoverySearchRun.update({
      where: { id: runId },
      data: {
        status: DiscoveryRunStatus.FAILED,
        error,
        completedAt,
      },
    });
  }

  async findExistingUrls(
    client: Client,
    normalizedUrls: string[],
  ): Promise<Set<string>> {
    if (normalizedUrls.length === 0) return new Set();

    const existing = await client.discoveredProfile.findMany({
      where: {
        normalizedUrl: { in: normalizedUrls },
        status: { not: "REJECTED" },
      },
      select: { normalizedUrl: true },
    });

    return new Set(existing.map((p) => p.normalizedUrl));
  }

  async createProfiles(
    client: Client,
    profiles: DiscoveredProfileInput[],
  ): Promise<number> {
    if (profiles.length === 0) return 0;

    const result = await client.discoveredProfile.createMany({
      data: profiles.map((p) => ({
        searchRunId: p.searchRunId,
        source: p.source,
        profileUrl: p.profileUrl,
        normalizedUrl: p.normalizedUrl,
        headline: p.headline ?? null,
        snippet: p.snippet ?? null,
        status: "NEW" as DiscoveredProfileStatus,
        rawData: p.rawData,
      })),
      skipDuplicates: true,
    });

    return result.count;
  }

  async completeRun(
    client: Client,
    runId: string,
    counters: RunCounters,
    completedAt: Date,
  ): Promise<RunRecord> {
    return client.discoverySearchRun.update({
      where: { id: runId },
      data: {
        resultCount: counters.resultCount,
        newProfiles: counters.newProfiles,
        duplicates: counters.duplicates,
        status: DiscoveryRunStatus.COMPLETED,
        completedAt,
      },
      select: {
        id: true,
        searchId: true,
        provider: true,
        status: true,
        startedAt: true,
        completedAt: true,
        resultCount: true,
        newProfiles: true,
        duplicates: true,
        error: true,
        createdAt: true,
      },
    });
  }
}

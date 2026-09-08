import axios, { AxiosInstance, AxiosResponse } from "axios";
import { SearchProvider } from "@prisma/client";
import { AppError } from "../errors/app-error.js";
import type {
  NormalizedSearchResult,
  SearchProviderContract,
} from "../types/discovery.js";

interface SerpApiOrganicResult {
  title?: unknown;
  link?: unknown;
  redirect_link?: unknown;
  displayed_link?: unknown;
  snippet?: unknown;
}

interface SerpApiResponse {
  organic_results?: unknown;
  error?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractString(
  obj: Record<string, unknown>,
  key: string,
): string | null {
  const val = obj[key];
  if (typeof val !== "string" || val.trim().length === 0) return null;
  return val.trim();
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function extractResultUrl(result: Record<string, unknown>): string | null {
  // Some Google/SerpAPI responses expose link as a relative /goto?... URL.
  // Prefer redirect_link when it contains the real destination.
  const candidates = [
    extractString(result, "redirect_link"),
    extractString(result, "link"),
    extractString(result, "displayed_link"),
  ];

  for (const candidate of candidates) {
    if (candidate && isValidHttpUrl(candidate)) return candidate;
  }

  return null;
}

export class SerpApiClient implements SearchProviderContract {
  readonly name = SearchProvider.SERPAPI;

  private readonly client: AxiosInstance;
  private readonly apiKey: string;
  private readonly resultsPerPage: number;

  constructor() {
    this.apiKey = process.env.SERPAPI_API_KEY?.trim() ?? "";

    if (!this.apiKey) {
      throw new AppError(
        "SERPAPI_API_KEY_MISSING",
        "SerpAPI API key is not configured",
        503,
      );
    }

    const configured = Number(process.env.SERPAPI_RESULTS_PER_PAGE);
    this.resultsPerPage = Number.isFinite(configured)
      ? Math.min(Math.max(Math.floor(configured), 1), 10)
      : 10;

    const configuredTimeout = Number(process.env.SERPAPI_TIMEOUT_MS);
    const timeout = Number.isFinite(configuredTimeout)
      ? Math.max(Math.floor(configuredTimeout), 1000)
      : 15000;

    this.client = axios.create({
      baseURL: "https://serpapi.com",
      timeout,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "htn-api/1.0 (Talent Discovery)",
      },
    });
  }

  async execute(query: string): Promise<NormalizedSearchResult[]> {
    let response: AxiosResponse<SerpApiResponse>;

    try {
      response = await this.client.get<SerpApiResponse>("/search", {
        params: {
          engine: "google",
          q: query,
          num: this.resultsPerPage,
          hl: "en",
          api_key: this.apiKey,
        },
      });
    } catch (error: unknown) {
      throw this.buildRequestError(error);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new AppError(
        "SERPAPI_HTTP_ERROR",
        `SerpAPI returned status ${response.status}`,
        502,
      );
    }

    return this.parseResults(response.data);
  }

  private parseResults(data: unknown): NormalizedSearchResult[] {
    if (!isRecord(data)) {
      throw new AppError(
        "SERPAPI_INVALID_RESPONSE",
        "Invalid response from SerpAPI",
        502,
      );
    }

    const body = data as SerpApiResponse;

    if (typeof body.error === "string" && body.error.trim().length > 0) {
      throw new AppError(
        "SERPAPI_ERROR_RESPONSE",
        `SerpAPI error: ${body.error}`,
        502,
      );
    }

    const results = body.organic_results;
    if (!Array.isArray(results)) {
      if (results === undefined || results === null) return [];
      throw new AppError(
        "SERPAPI_INVALID_RESPONSE",
        "Invalid response from SerpAPI",
        502,
      );
    }

    const mapped: NormalizedSearchResult[] = [];

    for (const item of results) {
      if (!isRecord(item)) continue;

      const url = extractResultUrl(item);
      if (!url) continue;

      mapped.push({
        title: extractString(item, "title"),
        url,
        snippet: extractString(item, "snippet"),
        provider: SearchProvider.SERPAPI,
      });
    }

    return mapped;
  }

  private buildRequestError(error: unknown): AppError {
    const err = error as {
      code?: string;
      response?: { status: number };
    };

    if (err && err.code === "ECONNABORTED") {
      return new AppError(
        "SERPAPI_TIMEOUT",
        "SerpAPI request timed out",
        504,
      );
    }

    if (err && err.code === "ETIMEDOUT") {
      return new AppError(
        "SERPAPI_TIMEOUT",
        "SerpAPI request timed out",
        504,
      );
    }

    if (!err || !("response" in err) || !err.response) {
      return new AppError(
        "SERPAPI_NETWORK_ERROR",
        "Failed to communicate with SerpAPI",
        502,
      );
    }

    return new AppError(
      "SERPAPI_HTTP_ERROR",
      `SerpAPI returned status ${err.response.status}`,
      502,
    );
  }
}

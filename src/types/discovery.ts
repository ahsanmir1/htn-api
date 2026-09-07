import type { ProfileSource, SearchProvider } from "@prisma/client";

export interface XRaySearchCriteria {
  roles?: string[];
  skills?: string[];
  locations?: string[];
  companies?: string[];
  sources?: ProfileSource[];
}

export interface NormalizedSearchResult {
  title: string | null;
  url: string;
  snippet: string | null;
  provider: SearchProvider;
}

export interface SearchProviderContract {
  readonly name: SearchProvider;
  execute(query: string): Promise<NormalizedSearchResult[]>;
}

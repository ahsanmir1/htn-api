import type { XRaySearchCriteria } from "../types/discovery.js";
import type { ProfileSource } from "@prisma/client";

const SOURCE_SITE_MAP: Record<ProfileSource, string | undefined> = {
  LINKEDIN: "site:linkedin.com/in/",
  GITHUB: "site:github.com/",
  WEBSITE: undefined,
  OTHER: undefined,
};

function quoteIfNeeded(term: string): string {
  return term.includes(" ") ? `"${term}"` : term;
}

function buildOrGroup(items: string[] | undefined): string | undefined {
  const filtered = (items ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (filtered.length === 0) return undefined;
  if (filtered.length === 1) return quoteIfNeeded(filtered[0]);

  const quoted = filtered.map((item) => `"${item}"`);
  return `(${quoted.join(" OR ")})`;
}

function buildSiteRestriction(
  sources: ProfileSource[] | undefined,
): string | undefined {
  if (!sources || sources.length === 0) return undefined;

  const sites = sources
    .map((s) => SOURCE_SITE_MAP[s])
    .filter((s): s is string => s !== undefined);

  if (sites.length === 0) return undefined;
  if (sites.length === 1) return sites[0];

  return `(${sites.join(" OR ")})`;
}

export function generateXRayQuery(criteria: XRaySearchCriteria): string {
  const parts: string[] = [];

  const site = buildSiteRestriction(criteria.sources);
  if (site) parts.push(site);

  const roleGroup = buildOrGroup(criteria.roles);
  if (roleGroup) parts.push(roleGroup);

  const skillGroup = buildOrGroup(criteria.skills);
  if (skillGroup) parts.push(skillGroup);

  const locationGroup = buildOrGroup(criteria.locations);
  if (locationGroup) parts.push(locationGroup);

  const companyGroup = buildOrGroup(criteria.companies);
  if (companyGroup) parts.push(companyGroup);

  return parts.join(" ");
}

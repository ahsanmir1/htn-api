import { ProfileSource } from "@prisma/client";

export function normalizeUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  let hostname = url.hostname.toLowerCase();

  if (hostname.startsWith("www.")) {
    hostname = hostname.slice(4);
  }

  const localeMatch = hostname.match(/^([a-z]{2})\.linkedin\.com$/);
  if (localeMatch) {
    hostname = "linkedin.com";
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  const normalizedPath = hostname.includes("linkedin.com")
    ? pathname.toLowerCase()
    : pathname;

  return `https://${hostname}${normalizedPath}`;
}

export function determineProfileSource(url: string): ProfileSource {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return ProfileSource.OTHER;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return ProfileSource.OTHER;
  }

  const hostname = parsed.hostname.toLowerCase();

  if (hostname === "linkedin.com" || hostname.endsWith(".linkedin.com")) {
    return ProfileSource.LINKEDIN;
  }

  if (hostname === "github.com" || hostname.endsWith(".github.com")) {
    return ProfileSource.GITHUB;
  }

  return ProfileSource.WEBSITE;
}

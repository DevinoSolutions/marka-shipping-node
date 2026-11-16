import { CanadaPostConfigurationError, CanadaPostError, CanadaPostParseError } from "../errors.js";
import { REST_ORIGIN, REST_PATH_PREFIX } from "./config.js";
import { safeUrl } from "./redact.js";
import type { RestLink } from "./types.js";

/**
 * Bearer tokens are sent with every request, so a link must never lead anywhere but the
 * Canada Post REST API (https, the configured origin and the portal path prefix, no embedded
 * credentials).
 */
export function assertTrustedRestHref(href: string): URL {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    // The raw value is not echoed: it may be a capability URL.
    throw new CanadaPostConfigurationError("Link href is not an absolute URL");
  }
  const refuse = (why: string): never => {
    throw new CanadaPostConfigurationError(
      `Refusing to follow ${safeUrl(url.origin + url.pathname)}: ${why} (bearer tokens are sent with every request)`,
    );
  };
  if (url.protocol !== "https:" || url.origin !== REST_ORIGIN) {
    refuse(`links must stay on ${REST_ORIGIN}`);
  }
  if (url.username !== "" || url.password !== "") refuse("links must not carry credentials");
  if (!url.pathname.startsWith(`${REST_PATH_PREFIX}/`)) {
    refuse(`links must stay under ${REST_PATH_PREFIX}/`);
  }
  return url;
}

/** Finds a link by relationship (case-insensitive). */
export function findRestLink(links: readonly RestLink[], rel: string): RestLink | undefined {
  const wanted = rel.toLowerCase();
  return links.find((l) => l.rel.toLowerCase() === wanted);
}

/** Like {@link findRestLink} but throws if the link is absent. */
export function requireRestLink(links: readonly RestLink[], rel: string): RestLink {
  const link = findRestLink(links, rel);
  if (link === undefined) {
    const have = links.map((l) => l.rel).join(", ") || "none";
    throw new CanadaPostError(`Response has no rel="${rel}" link (links present: ${have})`);
  }
  return link;
}

function isLink(value: unknown): value is RestLink {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { rel?: unknown }).rel === "string" &&
    typeof (value as { href?: unknown }).href === "string"
  );
}

/** Checks that a parsed JSON array holds links (`rel` and `href`) and returns it typed. */
export function asRestLinks(value: unknown[], operation: string): RestLink[] {
  if (!value.every(isLink)) {
    throw new CanadaPostParseError(`${operation}: expected a list of links in the response`);
  }
  return value;
}

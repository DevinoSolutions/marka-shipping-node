import { CanadaPostConfigurationError, CanadaPostError } from "./errors.js";
import { attr, children, toNumber, type XmlNode } from "./xml/parse.js";

/**
 * A `<link rel href media-type index>` element. Canada Post returns these instead of
 * documented URLs: follow them as given and send {@link CanadaPostLink.mediaType} as `Accept`.
 */
export interface CanadaPostLink {
  /** Relationship: `self`, `details`, `label`, `receipt`, `price`, `refund`, `manifest`, ... */
  rel: string;
  /** Absolute URL. Never rebuild or parse it. */
  href: string;
  /** Value for the `Accept` header when following the link. */
  mediaType: string | undefined;
  /** Page index of multi-page labels. */
  index: number | undefined;
}

/** Maps one `<link>` element. Returns undefined when it has no href. */
export function mapLink(node: XmlNode): CanadaPostLink | undefined {
  const href = attr(node, "href");
  if (href === undefined) return undefined;
  return {
    rel: attr(node, "rel") ?? "",
    href: href.replace(/\s+/g, ""),
    mediaType: attr(node, "media-type"),
    index: toNumber(attr(node, "index")),
  };
}

/** Maps every `<link>` child of an element (object-or-array tolerant). */
export function mapLinks(container: XmlNode | undefined): CanadaPostLink[] {
  const out: CanadaPostLink[] = [];
  for (const node of children(container, "link")) {
    const link = mapLink(node);
    if (link !== undefined) out.push(link);
  }
  return out;
}

/**
 * Finds a link by relationship (case-insensitive). When `index` is given, matches that page
 * of a multi-page artifact.
 */
export function findLink(
  links: readonly CanadaPostLink[],
  rel: string,
  index?: number,
): CanadaPostLink | undefined {
  const wanted = rel.toLowerCase();
  return links.find(
    (l) => l.rel.toLowerCase() === wanted && (index === undefined || l.index === index),
  );
}

/** Like {@link findLink} but throws if the link is absent. */
export function requireLink(
  links: readonly CanadaPostLink[],
  rel: string,
  index?: number,
): CanadaPostLink {
  const link = findLink(links, rel, index);
  if (link === undefined) {
    const have = links.map((l) => l.rel).join(", ") || "none";
    throw new CanadaPostError(`Response has no rel="${rel}" link (links present: ${have})`);
  }
  return link;
}

/**
 * Credentials are sent with every request, so a link must never lead somewhere other than the
 * configured environment host over HTTPS.
 */
export function assertTrustedHref(href: string, baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(href);
  } catch (cause) {
    throw new CanadaPostConfigurationError(`Link href is not an absolute URL: ${href}`, { cause });
  }
  const base = new URL(baseUrl);
  if (url.protocol !== "https:" || url.origin !== base.origin) {
    throw new CanadaPostConfigurationError(
      `Refusing to follow ${url.origin}: links must stay on ${base.origin} (credentials are sent with every request)`,
    );
  }
  return url;
}

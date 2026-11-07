import type { ResolvedConfig } from "../config.js";
import { CanadaPostValidationError } from "../errors.js";
import type { HttpTransport } from "../http.js";
import { assertTrustedHref, type CanadaPostLink } from "../links.js";

/** What every API namespace needs. */
export interface ApiContext {
  http: HttpTransport;
  config: ResolvedConfig;
}

/** A shipment/manifest id, a link returned by a previous call, or a full https URL. */
export type LinkOrId = string | CanadaPostLink;

/** Resolved request target. */
interface Target {
  url: string;
  /** Media type from the link, if one was given. */
  mediaType: string | undefined;
}

// Ids and service codes (`DOM.EP`): dots allowed between segments, never `..` or a leading dot.
const SAFE_ID = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

/** Validates an id that will be placed in a URL path. */
export function assertSafeId(value: string, field: string): string {
  if (value.length > 64 || !SAFE_ID.test(value)) {
    throw new CanadaPostValidationError(
      `${field} must be 1-64 letters, digits, underscores, hyphens or inner dots`,
    );
  }
  return value;
}

/**
 * Turns a user supplied id / link / URL into a request target. Ids are validated and
 * substituted with `build`; links and URLs must stay on the configured environment host.
 */
export function resolveTarget(
  ctx: ApiContext,
  arg: LinkOrId,
  field: string,
  build: (id: string) => string,
): Target {
  if (typeof arg === "string") {
    if (arg.startsWith("https://") || arg.startsWith("http://")) {
      return { url: assertTrustedHref(arg, ctx.config.baseUrl).toString(), mediaType: undefined };
    }
    return { url: `${ctx.config.baseUrl}${build(assertSafeId(arg, field))}`, mediaType: undefined };
  }
  return {
    url: assertTrustedHref(arg.href, ctx.config.baseUrl).toString(),
    mediaType: arg.mediaType,
  };
}

/** `/rs/{customer}/{mobo}` prefix of contract shipping and manifest endpoints. */
export function contractPrefix(ctx: ApiContext): string {
  return `/rs/${ctx.config.customerNumber}/${ctx.config.mobo}`;
}

/** Strips blanks and uppercases a Canadian postal code (`k1a 0b1` -> `K1A0B1`). */
export function normalizePostalCode(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** Compact `YYYYMMDD` date used by Get Manifests and Get Shipments. */
export function formatCompactDate(value: Date | string, field: string): string {
  if (typeof value === "string") {
    const digits = value.replace(/-/g, "");
    if (!/^\d{8}$/.test(digits)) {
      throw new CanadaPostValidationError(`${field} must be a Date or YYYYMMDD / YYYY-MM-DD`);
    }
    return digits;
  }
  if (Number.isNaN(value.getTime())) {
    throw new CanadaPostValidationError(`${field} is an invalid Date`);
  }
  const p = easternParts(value);
  return `${p.year}${p.month}${p.day}`;
}

/** `YYYYMMDDHHMM`, interpreted by Canada Post as Eastern time. */
export function formatCompactDateTime(value: Date | string, field: string): string {
  if (typeof value === "string") {
    if (!/^\d{12}$/.test(value)) {
      throw new CanadaPostValidationError(`${field} must be a Date or YYYYMMDDHHMM`);
    }
    return value;
  }
  if (Number.isNaN(value.getTime())) {
    throw new CanadaPostValidationError(`${field} is an invalid Date`);
  }
  const p = easternParts(value);
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}`;
}

function easternParts(date: Date): Record<"year" | "month" | "day" | "hour" | "minute", string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
  };
}

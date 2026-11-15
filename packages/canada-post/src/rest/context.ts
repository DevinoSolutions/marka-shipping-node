import { CanadaPostParseError, CanadaPostValidationError } from "../errors.js";
import type { ResolvedRestConfig } from "./config.js";
import { assertTrustedRestHref } from "./links.js";
import type { RestResult, RestTransport } from "./transport.js";
import { parseJsonBody } from "./transport.js";
import type { RestLink } from "./types.js";

/** What every REST API namespace needs. */
export interface RestContext {
  http: RestTransport;
  config: ResolvedRestConfig;
}

/** A shipment id (digits and letters) or a link returned by a previous call. */
export type RestTarget = string | RestLink;

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_CODE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;

/** Validates an id that will be placed in a URL path. */
function assertRestId(value: string, field: string): string {
  if (!SAFE_ID.test(value)) {
    throw new CanadaPostValidationError(
      `${field} must be 1-64 letters, digits, underscores or hyphens`,
    );
  }
  return value;
}

/** Validates a service / option code (`DOM.RP`, `DC`) that will be placed in a URL path. */
export function assertRestCode(value: string, field: string): string {
  if (value.length > 32 || !SAFE_CODE.test(value)) {
    throw new CanadaPostValidationError(
      `${field} must be 1-32 letters, digits, underscores, hyphens or inner dots`,
    );
  }
  return value;
}

/** Resolves a shipment id or a link to the URL to call. Links must stay on the REST host. */
export function resolveRestTarget(
  target: RestTarget,
  field: string,
  build: (id: string) => string,
): string {
  if (typeof target === "string") return build(assertRestId(target, field));
  return assertTrustedRestHref(target.href).toString();
}

/** Parses the JSON body of a successful read and checks it is an object. */
export function jsonObject(result: RestResult, operation: string): Record<string, unknown> {
  const body = parseJsonBody(result, operation);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new CanadaPostParseError(`${operation}: expected a JSON object in the response`);
  }
  return body as Record<string, unknown>;
}

/**
 * Like {@link jsonObject}, but also accepts a one-element array holding the object.
 *
 * Observed 2026-11-15: the Test app answers `GET .../details` and `GET .../price` with a
 * one-element array although the OpenAPI document specifies an object. Whether a Production
 * app does the same is an **ASSUMPTION**; accepting both keeps callers independent of it.
 */
export function jsonObjectOrSingleton(
  result: RestResult,
  operation: string,
): Record<string, unknown> {
  const body = parseJsonBody(result, operation);
  const candidate = Array.isArray(body) && body.length === 1 ? (body[0] as unknown) : body;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new CanadaPostParseError(
      `${operation}: expected a JSON object (or a one-element array holding one) in the response`,
    );
  }
  return candidate as Record<string, unknown>;
}

/** Parses the JSON body of a successful read and checks it is an array. */
export function jsonArray(result: RestResult, operation: string): unknown[] {
  const body = parseJsonBody(result, operation);
  if (!Array.isArray(body)) {
    throw new CanadaPostParseError(`${operation}: expected a JSON array in the response`);
  }
  return body as unknown[];
}

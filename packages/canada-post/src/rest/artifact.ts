import { CanadaPostApiError, CanadaPostError, CanadaPostParseError } from "../errors.js";
import type { RestContext } from "./context.js";
import { assertTrustedRestHref } from "./links.js";
import { safeUrl } from "./redact.js";
import type { RestArtifact, RestLink } from "./types.js";

/** An HTML error page must never be returned as a label. */
function checkArtifact(contentType: string, data: Uint8Array, operation: string): void {
  if (data.byteLength === 0) {
    throw new CanadaPostParseError(`${operation}: the artifact response is empty`);
  }
  if (contentType === "application/pdf") {
    const magic = new TextDecoder("latin1").decode(data.subarray(0, 5));
    if (magic !== "%PDF-") {
      throw new CanadaPostParseError(`${operation}: the response is not a PDF document`);
    }
  }
}

/** How {@link fetchArtifact} treats the request. */
interface FetchArtifactOptions {
  /**
   * The download consumes something (an open-return label): never retried or replayed, and an
   * ambiguous failure is {@link CanadaPostIndeterminateError}.
   */
  mutating?: boolean;
  recovery?: string;
}

/** Downloads a binary artifact (PDF or ZPL) through a link on the Canada Post host. */
export async function fetchArtifact(
  ctx: RestContext,
  link: RestLink,
  operation: string,
  options: FetchArtifactOptions = {},
): Promise<RestArtifact> {
  const url = assertTrustedRestHref(link.href).toString();
  const accept = link.mediaType === "" ? "application/pdf" : link.mediaType;
  const result = await ctx.http.execute({
    operation,
    method: "GET",
    url,
    accept,
    ...(options.mutating === true
      ? {
          mutating: true,
          ...(options.recovery === undefined ? {} : { recovery: options.recovery }),
        }
      : {}),
  });
  if (result.status !== 200) {
    throw new CanadaPostApiError({
      status: result.status,
      messages: [],
      request: { method: "GET", url: safeUrl(url), operation },
      requestId: result.requestId,
    });
  }
  const contentType = result.contentType?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/pdf" && contentType !== "application/zpl") {
    throw new CanadaPostError(
      `${operation}: unexpected content type ${JSON.stringify((contentType ?? "none").slice(0, 60))} (expected application/pdf or application/zpl)`,
    );
  }
  checkArtifact(contentType, result.data, operation);
  return { contentType, data: result.data };
}

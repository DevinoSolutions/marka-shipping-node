import { CanadaPostValidationError } from "../errors.js";
import { queryString } from "../http.js";
import {
  accountUrl,
  getJson,
  jsonArray,
  jsonObjectOrSingleton,
  resolveRestTarget,
  toCompactDate,
  type RestContext,
  type RestTarget,
} from "./context.js";
import { asRestLinks } from "./links.js";
import type { RestLink, RestManifestDetails, RestManifestInfo } from "./types.js";

/** Filters of {@link RestManifestsApi.list}. */
export interface RestManifestListInput {
  /**
   * Start of the date range (`YYYY-MM-DD` or `YYYYMMDD`). Required: a Production app rejects
   * a request without it with HTTP 400 (errorCode 9105).
   */
  from: string;
  /** End of the date range (`YYYY-MM-DD` or `YYYYMMDD`). Optional. */
  to?: string;
}

/**
 * Manifests of the account (Shipping v1). Reading is free; transmitting a manifest is
 * {@link RestShipmentsApi.transmit}.
 */
export class RestManifestsApi {
  constructor(private readonly ctx: RestContext) {}

  /** Links to the manifests of a date range (`from` is required, `to` optional). */
  async list(input: RestManifestListInput): Promise<RestLink[]> {
    // The type requires `from`, but plain JavaScript callers and the MCP bridge can omit it.
    if ((input as { from?: string } | undefined)?.from === undefined) {
      throw new CanadaPostValidationError("manifests.list requires `from` (YYYY-MM-DD)");
    }
    const query = queryString({
      from: toCompactDate(input.from, "from"),
      to: input.to === undefined ? undefined : toCompactDate(input.to, "to"),
    });
    const result = await getJson(
      this.ctx,
      "manifests.list",
      `${accountUrl(this.ctx, "shipping")}/manifests${query}`,
    );
    return asRestLinks(jsonArray(result, "manifests.list"), "manifests.list");
  }

  /** The PO number and links (artifacts, details) of a manifest. */
  async get(target: RestTarget): Promise<RestManifestInfo> {
    const result = await getJson(
      this.ctx,
      "manifests.get",
      resolveRestTarget(
        target,
        "manifest id",
        (id) => `${accountUrl(this.ctx, "shipping")}/manifests/${id}`,
      ),
    );
    return jsonObjectOrSingleton(result, "manifests.get") as unknown as RestManifestInfo;
  }

  /** Date, shipping point, payment and cost of a manifest. */
  async getDetails(target: RestTarget): Promise<RestManifestDetails> {
    const result = await getJson(
      this.ctx,
      "manifests.getDetails",
      resolveRestTarget(
        target,
        "manifest id",
        (id) => `${accountUrl(this.ctx, "shipping")}/manifests/${id}/details`,
      ),
    );
    return jsonObjectOrSingleton(result, "manifests.getDetails") as unknown as RestManifestDetails;
  }
}

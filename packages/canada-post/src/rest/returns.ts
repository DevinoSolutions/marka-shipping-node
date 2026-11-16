import { CanadaPostValidationError } from "../errors.js";
import { fetchArtifact } from "./artifact.js";
import {
  accountUrl,
  getJson,
  jsonArray,
  jsonObjectOrSingleton,
  resolveRestTarget,
  type RestContext,
  type RestTarget,
} from "./context.js";
import { asRestLinks, requireRestLink } from "./links.js";
import type { RestArtifact, RestLink } from "./types.js";
import type {
  RestAuthorizedReturnInfo,
  RestAuthorizedReturnRequest,
  RestOpenReturnDetails,
  RestOpenReturnInfo,
  RestOpenReturnRequest,
} from "./types-services.js";

/** Where a returns label can be found: a response with links, or the label link itself. */
export type RestReturnLabelSource = RestLink | { links: readonly RestLink[] };

const AUTHORIZED_RECOVERY =
  "Authorized returns are not idempotent. Look the return up in Canada Post (the tracking PIN " +
  "or your customerBarcode) before retrying: a second request is a second, billed return label.";
const OPEN_RECOVERY =
  "Check returns.listOpen() before retrying: a second request creates a second template.";
const DELETE_RECOVERY =
  "Check returns.getOpen(id) before retrying: it fails once the template is deleted.";
const ARTIFACT_RECOVERY =
  "Each download consumes one label of the template. Check returns.getOpen(id).artifactsRemaining " +
  "before retrying.";

function returnsUrl(ctx: RestContext): string {
  return accountUrl(ctx, "returns");
}

function assertServiceCode(code: string): void {
  if (code === "" || code.length > 32) {
    throw new CanadaPostValidationError("serviceCode must be 1-32 characters");
  }
}

/**
 * Return labels (Returns v1). `createAuthorized` and `createOpen` charge in a Production app
 * and are never retried.
 */
export class RestReturnsApi {
  constructor(private readonly ctx: RestContext) {}

  /**
   * Creates an authorized return (a prepaid return label for one parcel). **Bills in a
   * Production app.** Never retried; an ambiguous failure is
   * {@link CanadaPostIndeterminateError}.
   */
  async createAuthorized(request: RestAuthorizedReturnRequest): Promise<RestAuthorizedReturnInfo> {
    assertServiceCode(request.serviceCode);
    const result = await this.ctx.http.execute({
      operation: "returns.createAuthorized",
      method: "POST",
      url: `${returnsUrl(this.ctx)}/authorized-returns`,
      accept: "application/json",
      body: request,
      mutating: true,
      recovery: AUTHORIZED_RECOVERY,
    });
    return jsonObjectOrSingleton(
      result,
      "returns.createAuthorized",
    ) as unknown as RestAuthorizedReturnInfo;
  }

  /**
   * Creates an open-return template: a reusable source of up to `maxNumberOfArtifacts` return
   * labels. **Labels bill when they are used in a Production app.** Never retried.
   */
  async createOpen(request: RestOpenReturnRequest): Promise<RestOpenReturnInfo> {
    assertServiceCode(request.serviceCode);
    if (!Number.isInteger(request.maxNumberOfArtifacts) || request.maxNumberOfArtifacts < 1) {
      throw new CanadaPostValidationError("maxNumberOfArtifacts must be an integer of at least 1");
    }
    const result = await this.ctx.http.execute({
      operation: "returns.createOpen",
      method: "POST",
      url: `${returnsUrl(this.ctx)}/open-returns`,
      accept: "application/json",
      body: request,
      mutating: true,
      recovery: OPEN_RECOVERY,
    });
    return jsonObjectOrSingleton(result, "returns.createOpen") as unknown as RestOpenReturnInfo;
  }

  /** Links to the open-return templates of the account. */
  async listOpen(): Promise<RestLink[]> {
    const result = await getJson(
      this.ctx,
      "returns.listOpen",
      `${returnsUrl(this.ctx)}/open-returns`,
    );
    return asRestLinks(jsonArray(result, "returns.listOpen"), "returns.listOpen");
  }

  /** One open-return template and the number of labels it can still produce. */
  async getOpen(target: RestTarget): Promise<RestOpenReturnInfo> {
    const result = await getJson(
      this.ctx,
      "returns.getOpen",
      resolveRestTarget(
        target,
        "open return id",
        (id) => `${returnsUrl(this.ctx)}/open-returns/${id}`,
      ),
    );
    return jsonObjectOrSingleton(result, "returns.getOpen") as unknown as RestOpenReturnInfo;
  }

  /** The full request of an open-return template and its remaining labels. */
  async getOpenDetails(target: RestTarget): Promise<RestOpenReturnDetails> {
    const result = await getJson(
      this.ctx,
      "returns.getOpenDetails",
      resolveRestTarget(
        target,
        "open return id",
        (id) => `${returnsUrl(this.ctx)}/open-returns/${id}/details`,
      ),
    );
    return jsonObjectOrSingleton(
      result,
      "returns.getOpenDetails",
    ) as unknown as RestOpenReturnDetails;
  }

  /** Deletes an open-return template. Never retried. */
  async deleteOpen(target: RestTarget): Promise<void> {
    await this.ctx.http.execute({
      operation: "returns.deleteOpen",
      method: "DELETE",
      url: resolveRestTarget(
        target,
        "open return id",
        (id) => `${returnsUrl(this.ctx)}/open-returns/${id}`,
      ),
      accept: "application/json",
      mutating: true,
      recovery: DELETE_RECOVERY,
    });
  }

  /**
   * Downloads the next label of an open-return template. A GET on the wire, but **it consumes
   * one label** (`artifactsRemaining` goes down, and a Production app may bill it), so it is
   * classified as a write and never retried or replayed. Pass the template id or its
   * `artifact` link.
   */
  async getOpenArtifact(target: RestTarget): Promise<RestArtifact> {
    const link: RestLink =
      typeof target === "string"
        ? {
            rel: "artifact",
            mediaType: "application/pdf",
            href: resolveRestTarget(
              target,
              "open return id",
              (id) => `${returnsUrl(this.ctx)}/open-returns/${id}/artifact`,
            ),
          }
        : target;
    return fetchArtifact(this.ctx, link, "returns.getOpenArtifact", {
      mutating: true,
      recovery: ARTIFACT_RECOVERY,
    });
  }

  /**
   * Downloads the label of an authorized return. Pass the {@link createAuthorized} response (or
   * anything with its `links`), or the label link itself. A re-readable download.
   */
  async getAuthorizedLabel(source: RestReturnLabelSource): Promise<RestArtifact> {
    const link = "links" in source ? requireRestLink(source.links, "label") : source;
    return fetchArtifact(this.ctx, link, "returns.getAuthorizedLabel");
  }
}

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { MEDIA_TYPES } from "../config.js";
import { CanadaPostApiError, CanadaPostValidationError } from "../errors.js";
import { assertTrustedHref, type CanadaPostLink } from "../links.js";
import type { ApiContext } from "./context.js";

/** A downloaded artifact: a label (PDF or ZPL II), a commercial invoice or a manifest. */
export interface Artifact {
  /** `application/pdf` or `application/zpl` (without parameters). */
  contentType: string;
  /** Raw bytes. ZPL is ASCII text: `new TextDecoder().decode(data)`. */
  data: Uint8Array;
}

/** Options of {@link ArtifactsApi.get}. */
export interface GetArtifactOptions {
  /**
   * `Accept` to send when `target` is a bare URL. Ignored for links (their `mediaType` wins).
   * Default `application/pdf`; use `application/zpl` for thermal labels.
   */
  accept?: string;
  /** Extra attempts while Canada Post answers HTTP 202 (not rendered yet). Default 4. */
  pollAttempts?: number;
  /** Wait between 202 polls in ms. Default 1000. */
  pollIntervalMs?: number;
}

/** Result of {@link ArtifactsApi.saveToFile}. */
export interface SavedArtifact {
  path: string;
  bytes: number;
  contentType: string;
}

/** Writes an artifact to disk (creating parent directories). Returns the byte count. */
export async function saveArtifact(artifact: Artifact, path: string): Promise<SavedArtifact> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, artifact.data);
  return { path, bytes: artifact.data.byteLength, contentType: artifact.contentType };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Labels, commercial invoices and manifests, downloaded through the links Canada Post returns. */
export class ArtifactsApi {
  constructor(private readonly ctx: ApiContext) {}

  /**
   * Downloads an artifact through a `label` / `returnLabel` / `commercialInvoice` /
   * `artifact` link (or its URL). Returns the raw bytes and content type, so PDF and ZPL both
   * work. The same label (same barcode) is returned on every call for 90 days.
   *
   * Right after a shipment is created the label may not be rendered yet; HTTP 202 is polled
   * a few times, then {@link CanadaPostApiError} (`isPending`) is thrown.
   */
  async get(target: CanadaPostLink | string, options: GetArtifactOptions = {}): Promise<Artifact> {
    const { ctx } = this;
    let url: string;
    let accept: string;
    if (typeof target === "string") {
      if (!target.startsWith("https://")) {
        throw new CanadaPostValidationError("An artifact target must be a link or an https URL");
      }
      url = assertTrustedHref(target, ctx.config.baseUrl).toString();
      accept = options.accept ?? MEDIA_TYPES.pdf;
    } else {
      url = assertTrustedHref(target.href, ctx.config.baseUrl).toString();
      accept = target.mediaType ?? options.accept ?? MEDIA_TYPES.pdf;
    }
    const attempts = (options.pollAttempts ?? 4) + 1;
    const interval = options.pollIntervalMs ?? 1000;
    for (let i = 0; i < attempts; i += 1) {
      const res = await ctx.http.execute({
        operation: "artifacts.get",
        method: "GET",
        url,
        accept,
        binary: true,
        pendingOk: true,
      });
      if (res.status !== 202) {
        const header = res.contentType?.split(";")[0]?.trim();
        return {
          contentType: header !== undefined && header !== "" ? header : accept,
          data: res.data,
        };
      }
      if (i + 1 < attempts && interval > 0) await sleep(interval);
    }
    throw new CanadaPostApiError({
      status: 202,
      messages: [],
      request: { method: "GET", url, operation: "artifacts.get" },
    });
  }

  /** {@link ArtifactsApi.get} followed by {@link saveArtifact}. */
  async saveToFile(
    target: CanadaPostLink | string,
    path: string,
    options: GetArtifactOptions = {},
  ): Promise<SavedArtifact> {
    return saveArtifact(await this.get(target, options), path);
  }
}

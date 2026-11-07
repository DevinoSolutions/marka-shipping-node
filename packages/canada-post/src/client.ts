import { ArtifactsApi, type Artifact } from "./api/artifacts.js";
import type { ApiContext } from "./api/context.js";
import { ManifestsApi } from "./api/manifests.js";
import { NcShipmentsApi } from "./api/nc-shipments.js";
import { RatingApi } from "./api/rating.js";
import { ShipmentsApi } from "./api/shipments.js";
import { TrackingApi } from "./api/tracking.js";
import {
  resolveConfig,
  type CanadaPostClientOptions,
  type CanadaPostEnvironment,
} from "./config.js";
import { CanadaPostValidationError } from "./errors.js";
import { HttpTransport } from "./http.js";
import { assertTrustedHref, type CanadaPostLink } from "./links.js";
import { parseXml, type XmlNode } from "./xml/parse.js";

/** Result of {@link CanadaPostClient.followLink}. */
export type FollowedLink =
  | {
      kind: "xml";
      rel: string;
      status: number;
      /** Parsed document, `{ rootElementName: contents }`. */
      raw: XmlNode;
      text: string;
    }
  | ({ kind: "binary"; rel: string } & Artifact);

/** The Canada Post client. Create it with {@link createCanadaPostClient}. */
export interface CanadaPostClient {
  /** `development` (sandbox) or `production`. */
  readonly environment: CanadaPostEnvironment;
  /** Host all requests go to. */
  readonly baseUrl: string;
  /** Quotes, service discovery, options. Read-only. */
  readonly rating: RatingApi;
  /** Non-contract shipping (credit card). `create` charges in production. */
  readonly ncShipments: NcShipmentsApi;
  /** Contract shipping. `create`/`transmit` charge in production. */
  readonly shipments: ShipmentsApi;
  /** Manifests created by `shipments.transmit`. */
  readonly manifests: ManifestsApi;
  /** Label / invoice / manifest downloads. */
  readonly artifacts: ArtifactsApi;
  /** Parcel tracking. Read-only. */
  readonly tracking: TrackingApi;
  /**
   * Follows any GET link Canada Post returned, sending the link's own `media-type` as
   * `Accept`. XML links come back parsed; PDF / ZPL links come back as bytes. `refund` links
   * are POST endpoints and are rejected (use the `requestRefund` methods).
   */
  followLink(link: CanadaPostLink): Promise<FollowedLink>;
}

/**
 * Creates a client.
 *
 * `environment` defaults to `"development"` (the Canada Post sandbox). Production must be
 * requested explicitly, and creating shipments or transmitting manifests there charges real
 * postage. Credentials are only ever sent in the `Authorization` header and are never logged.
 */
export function createCanadaPostClient(options: CanadaPostClientOptions): CanadaPostClient {
  const config = resolveConfig(options);
  const ctx: ApiContext = { http: new HttpTransport(config), config };
  const artifacts = new ArtifactsApi(ctx);
  return {
    environment: config.environment,
    baseUrl: config.baseUrl,
    rating: new RatingApi(ctx),
    ncShipments: new NcShipmentsApi(ctx),
    shipments: new ShipmentsApi(ctx),
    manifests: new ManifestsApi(ctx),
    artifacts,
    tracking: new TrackingApi(ctx),
    async followLink(link: CanadaPostLink): Promise<FollowedLink> {
      if (link.rel.toLowerCase() === "refund") {
        throw new CanadaPostValidationError(
          "A refund link is a POST endpoint; use ncShipments.requestRefund / shipments.requestRefund",
        );
      }
      const url = assertTrustedHref(link.href, config.baseUrl).toString();
      const mediaType = link.mediaType ?? "";
      if (mediaType !== "" && !/xml/i.test(mediaType)) {
        return { kind: "binary", rel: link.rel, ...(await artifacts.get(link)) };
      }
      const res = await ctx.http.execute({
        operation: `followLink(${link.rel})`,
        method: "GET",
        url,
        accept: mediaType === "" ? "application/xml" : mediaType,
      });
      return {
        kind: "xml",
        rel: link.rel,
        status: res.status,
        raw: parseXml(res.text),
        text: res.text,
      };
    },
  };
}

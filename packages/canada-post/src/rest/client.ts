import { OAuthTokenProvider } from "./oauth.js";
import { REST_BASE_URL, resolveRestConfig, type CanadaPostRestClientOptions } from "./config.js";
import type { RestContext } from "./context.js";
import { assertTrustedRestHref } from "./links.js";
import { SecretRedactor, safeUrl } from "./redact.js";
import { RestRatingApi } from "./rating.js";
import { fetchArtifact, RestShipmentsApi } from "./shipments.js";
import { assertTestApp, probeTestApp, type TestAppProbeResult } from "./test-app.js";
import { RestTransport, parseJsonBody } from "./transport.js";
import type { RestApp, RestArtifact, RestLink } from "./types.js";

/** Result of {@link CanadaPostRestClient.followLink}. */
export type RestFollowedLink =
  | { kind: "json"; rel: string; status: number; body: unknown }
  | ({ kind: "binary"; rel: string } & RestArtifact);

/** The Canada Post REST/OAuth client. Create it with {@link createCanadaPostRestClient}. */
export interface CanadaPostRestClient {
  /** The app type the caller DECLARED (`"test"` by default). */
  readonly app: RestApp;
  /** Base URL of the APIs. */
  readonly baseUrl: string;
  /** Contract shipments. `create` charges real postage in a Production app. */
  readonly shipments: RestShipmentsApi;
  /** Quotes, service discovery, options. Read-only. */
  readonly rating: RestRatingApi;
  /**
   * Follows a GET link Canada Post returned (only on the Canada Post API host, so the bearer
   * token cannot leak). JSON links come back parsed; PDF / ZPL links as bytes.
   */
  followLink(link: RestLink): Promise<RestFollowedLink>;
  /**
   * Tries to prove the credentials belong to a Canada Post Test app: sends two very different
   * quote requests and expects byte-identical (static stub) answers. Never throws for a failed
   * proof; see {@link TestAppProbeResult}. Quotes only: nothing is created.
   */
  probeTestApp(): Promise<TestAppProbeResult>;
  /**
   * The safety interlock of the live test-app suite: resolves only when
   * {@link CanadaPostRestClient.probeTestApp} proves a Test app, otherwise throws
   * {@link CanadaPostTestAppRequiredError}. A client declared `app: "production"` always
   * throws, without sending anything.
   */
  assertTestApp(): Promise<void>;
}

/**
 * Creates a client for the new Canada Post Developer Portal APIs (REST/JSON, OAuth2
 * `client_credentials`). The XML client ({@link createCanadaPostClient}) is unaffected.
 *
 * `app` defaults to `"test"` and must be declared by the caller: the SDK never reads it from
 * the environment and cannot tell the apps apart on its own (use `assertTestApp()` to prove a
 * Test app). Credentials only travel to the token endpoint and in the `Authorization` header;
 * the client secret and tokens never appear in errors, logs or debug events.
 */
export function createCanadaPostRestClient(
  options: CanadaPostRestClientOptions,
): CanadaPostRestClient {
  const config = resolveRestConfig(options);
  const redactor = new SecretRedactor();
  redactor.add(config.zonosKey);
  const tokens = new OAuthTokenProvider(config, redactor);
  const ctx: RestContext = { http: new RestTransport(config, tokens, redactor), config };
  return {
    app: config.app,
    baseUrl: REST_BASE_URL,
    shipments: new RestShipmentsApi(ctx),
    rating: new RestRatingApi(ctx),
    async followLink(link: RestLink): Promise<RestFollowedLink> {
      const url = assertTrustedRestHref(link.href).toString();
      if (/json/i.test(link.mediaType)) {
        const operation = `followLink(${link.rel})`;
        const result = await ctx.http.execute({
          operation,
          method: "GET",
          url,
          accept: link.mediaType,
        });
        return {
          kind: "json",
          rel: link.rel,
          status: result.status,
          body: parseJsonBody(result, `${operation} ${safeUrl(url)}`),
        };
      }
      return { kind: "binary", rel: link.rel, ...(await fetchArtifact(ctx, link, "followLink")) };
    },
    probeTestApp: () => probeTestApp(ctx),
    assertTestApp: () => assertTestApp(ctx),
  };
}

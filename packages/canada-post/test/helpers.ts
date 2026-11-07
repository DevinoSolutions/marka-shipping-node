import { createCanadaPostClient, type CanadaPostClientOptions } from "../src/index.js";
import {
  createMockFetch,
  type MockFetch,
  type MockReply,
  type RecordedRequest,
} from "../src/testing/index.js";

export const TEST_USERNAME = "test-user";
export const TEST_PASSWORD = "test-password";
export const TEST_CUSTOMER = "1234567";
export const TEST_CONTRACT = "0012345678";

type Script = MockReply | readonly MockReply[] | ((r: RecordedRequest, i: number) => MockReply);

/** Builds a client wired to a scripted fetch. Retry delays are zero so tests are instant. */
export function makeClient(
  script: Script,
  overrides: Partial<CanadaPostClientOptions> = {},
): { client: ReturnType<typeof createCanadaPostClient>; mock: MockFetch } {
  const mock = createMockFetch(script);
  const client = createCanadaPostClient({
    username: TEST_USERNAME,
    password: TEST_PASSWORD,
    customerNumber: TEST_CUSTOMER,
    fetch: mock.fetch,
    retryDelayMs: 0,
    ...overrides,
  });
  return { client, mock };
}

/** XML reply with the given media type. */
export function xml(body: string, mediaType: string, status = 200): MockReply {
  return { status, body, headers: { "content-type": mediaType } };
}

/** The Authorization header the SDK must send, computed independently of the SDK. */
export function expectedBasic(): string {
  return `Basic ${Buffer.from(`${TEST_USERNAME}:${TEST_PASSWORD}`, "utf8").toString("base64")}`;
}

/** The first recorded request (fails the test if there is none). */
export function first(mock: MockFetch): RecordedRequest {
  const r = mock.requests[0];
  if (r === undefined) throw new Error("no request was recorded");
  return r;
}

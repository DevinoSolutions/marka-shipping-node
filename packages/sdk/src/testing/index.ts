/**
 * Test helpers for code that uses the SDK: a scripted `fetch` that records requests.
 * Import from `@joinmarka/shipping/testing`.
 *
 * @packageDocumentation
 */

/** One scripted reply. */
export interface MockReply {
  status?: number;
  /** Response body. Strings are sent as UTF-8; byte arrays as-is. */
  body?: string | Uint8Array;
  headers?: Record<string, string>;
  /** Throw this instead of answering (simulates a network failure). */
  error?: Error;
  /** Never answer; resolves only when the request is aborted (simulates a hang). */
  hang?: boolean;
}

/** What the SDK sent. */
export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** A scripted `fetch` plus the requests it saw. */
export interface MockFetch {
  fetch: typeof fetch;
  requests: RecordedRequest[];
}

/**
 * Creates a `fetch` that answers from a script in order (the last reply repeats), or from a
 * function. Pass `mock.fetch` as the client's `fetch` option.
 */
export function createMockFetch(
  script:
    MockReply | readonly MockReply[] | ((request: RecordedRequest, index: number) => MockReply),
): MockFetch {
  const requests: RecordedRequest[] = [];
  const impl = async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const recorded: RecordedRequest = {
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    const index = requests.length;
    requests.push(recorded);
    let reply: MockReply;
    if (typeof script === "function") reply = script(recorded, index);
    else if (Array.isArray(script)) {
      const list = script as readonly MockReply[];
      reply = list[Math.min(index, list.length - 1)] ?? {};
    } else reply = script as MockReply;

    if (reply.error !== undefined) throw reply.error;
    if (reply.hang === true) {
      await new Promise<never>((_resolve, reject) => {
        const signal = init?.signal;
        const fail = (): void => {
          reject(new DOMException("The operation was aborted", "AbortError"));
        };
        if (signal?.aborted === true) fail();
        else signal?.addEventListener("abort", fail, { once: true });
      });
    }
    const status = reply.status ?? 200;
    const body = reply.body ?? "";
    const payload = typeof body === "string" ? body : new Uint8Array(body);
    return new Response(status === 204 || status === 304 ? null : payload, {
      status,
      headers: reply.headers ?? {},
    });
  };
  return { fetch: impl as typeof fetch, requests };
}

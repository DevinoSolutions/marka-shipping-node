const REDACTED = "[REDACTED]";

/** Query parameters whose value is a capability or credential (for example `key-cle=`). */
const SENSITIVE_QUERY = /key|token|secret|signature|sig|password|credential/i;

/** Mutable set of secret strings that must never appear in an error, log or debug event. */
export class SecretRedactor {
  private readonly secrets = new Set<string>();

  /** Registers a value to scrub from anything echoed back. Short values are ignored. */
  add(secret: string | undefined): void {
    if (secret !== undefined && secret.length >= 6) this.secrets.add(secret);
  }

  /** Replaces every registered secret in `text`. */
  scrub(text: string): string {
    let out = text;
    for (const secret of this.secrets) {
      if (out.includes(secret)) out = out.split(secret).join(REDACTED);
    }
    return out;
  }
}

/** The URL with the value of credential-like query parameters replaced. */
export function safeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url.split("?")[0] ?? url;
  }
  if (parsed.username !== "" || parsed.password !== "") {
    parsed.username = "";
    parsed.password = "";
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (SENSITIVE_QUERY.test(key)) parsed.searchParams.set(key, REDACTED);
  }
  return parsed.toString().replace(/%5BREDACTED%5D/g, REDACTED);
}

/** Resolves after `ms` milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `Retry-After` in milliseconds, capped at 30 s. */
export function retryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (raw === null) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  return undefined;
}

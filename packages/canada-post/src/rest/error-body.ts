import type { CanadaPostMessage } from "../errors.js";
import { extractMessages } from "../http.js";

/** What could be read from an error response body. */
interface ParsedErrorBody {
  messages: CanadaPostMessage[];
  title: string | undefined;
  detail: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function fromRecord(body: Record<string, unknown>, out: ParsedErrorBody): void {
  // Documented: `{ title, detail, errors: [{ errorCode, message }] }`.
  const errors = body["errors"];
  if (Array.isArray(errors)) {
    for (const entry of errors) {
      if (!isRecord(entry)) continue;
      out.messages.push({
        code: text(entry["errorCode"]) ?? "",
        description: text(entry["message"]) ?? "",
      });
    }
  }
  out.title ??= text(body["title"]);
  out.detail ??= text(body["detail"]);

  // Gateway 401: `{ httpCode, httpMessage, moreInformation }` (the spec example wraps it in an array).
  const httpCode = text(body["httpCode"]);
  if (httpCode !== undefined) {
    const description = [text(body["httpMessage"]), text(body["moreInformation"])]
      .filter((v): v is string => v !== undefined && v !== "")
      .join(": ");
    out.messages.push({ code: httpCode, description });
  }

  // Observed from the Test app for schema failures: `{ errorCode, errorMessage, errorDescription }`.
  const errorCode = text(body["errorCode"]);
  if (errorCode !== undefined && !Array.isArray(errors)) {
    const description = [text(body["errorMessage"]), text(body["errorDescription"])]
      .filter((v): v is string => v !== undefined && v !== "")
      .join(": ");
    out.title ??= text(body["errorMessage"]);
    out.detail ??= text(body["errorDescription"]);
    out.messages.push({ code: errorCode, description });
  }

  // OAuth style: `{ error, error_description }`.
  const oauthError = text(body["error"]);
  if (oauthError !== undefined) {
    out.messages.push({ code: oauthError, description: text(body["error_description"]) ?? "" });
  }
}

/** A title/detail without any error entry still deserves a message in the summary. */
function withTitleFallback(out: ParsedErrorBody): ParsedErrorBody {
  if (out.messages.length === 0 && (out.title !== undefined || out.detail !== undefined)) {
    out.messages.push({
      code: "",
      description: [out.title, out.detail].filter((v) => v !== undefined && v !== "").join(": "),
    });
  }
  return out;
}

/**
 * Reads whatever Canada Post (or the API gateway in front of it) put in an error body. The
 * body may be a documented `{ title, detail, errors }` object, a gateway object or array, an
 * OAuth error, XML `<messages>` or plain text; an unreadable body yields no messages (the
 * caller keeps a redacted excerpt).
 */
export function parseErrorBody(raw: string): ParsedErrorBody {
  const out: ParsedErrorBody = { messages: [], title: undefined, detail: undefined };
  const trimmed = raw.trim();
  if (trimmed === "") return out;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const body: unknown = JSON.parse(trimmed);
      if (Array.isArray(body)) {
        for (const entry of body) if (isRecord(entry)) fromRecord(entry, out);
      } else if (isRecord(body)) {
        fromRecord(body, out);
      }
    } catch {
      // not JSON after all
    }
    return withTitleFallback(out);
  }
  const xml = extractMessages(trimmed);
  if (xml !== undefined) out.messages.push(...xml);
  return out;
}

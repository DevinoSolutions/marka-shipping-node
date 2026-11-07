import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CanadaPostApiError,
  CanadaPostConfigurationError,
  saveArtifact,
  type CanadaPostLink,
} from "../src/index.js";
import { FIXTURE_HOST } from "./fixtures.js";
import { first, makeClient } from "./helpers.js";

const LABEL_URL = `${FIXTURE_HOST}/rs/artifact/76108cb5192002d5/10238/0`;
// A tiny "PDF" with bytes that corrupt if the body is ever decoded as UTF-8 text.
const PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0xff, 0x00, 0xfe, 0x80, 0xc3, 0x28, 0x0a,
]);

function label(mediaType: string | undefined): CanadaPostLink {
  return { rel: "label", href: LABEL_URL, mediaType, index: 0 };
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("artifacts.get", () => {
  it("returns binary PDF bytes untouched and sends the link's media type", async () => {
    const { client, mock } = makeClient({
      status: 200,
      body: PDF_BYTES,
      headers: { "content-type": "application/pdf" },
    });
    const artifact = await client.artifacts.get(label("application/pdf"));
    expect(first(mock).method).toBe("GET");
    expect(first(mock).url).toBe(LABEL_URL);
    expect(first(mock).headers["accept"]).toBe("application/pdf");
    expect(artifact.contentType).toBe("application/pdf");
    expect(artifact.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(artifact.data)).toEqual(Array.from(PDF_BYTES));
  });

  it("supports ZPL labels (text commands as bytes)", async () => {
    const zpl = "^XA^FO50,50^FDHello^FS^XZ";
    const { client, mock } = makeClient({
      status: 200,
      body: zpl,
      headers: { "content-type": "application/zpl; charset=UTF-8" },
    });
    const artifact = await client.artifacts.get(label("application/zpl"));
    expect(first(mock).headers["accept"]).toBe("application/zpl");
    expect(artifact.contentType).toBe("application/zpl");
    expect(new TextDecoder().decode(artifact.data)).toBe(zpl);
  });

  it("accepts a bare https URL plus an explicit Accept", async () => {
    const { client, mock } = makeClient({ body: new TextEncoder().encode("^XA^XZ") });
    const artifact = await client.artifacts.get(LABEL_URL, { accept: "application/zpl" });
    expect(first(mock).headers["accept"]).toBe("application/zpl");
    // No content-type header was sent back: fall back to what was requested.
    expect(artifact.contentType).toBe("application/zpl");
  });

  it("polls while the label is still rendering (HTTP 202), then returns it", async () => {
    const { client, mock } = makeClient([
      { status: 202, body: "" },
      { status: 202, body: "" },
      { status: 200, body: PDF_BYTES, headers: { "content-type": "application/pdf" } },
    ]);
    const artifact = await client.artifacts.get(label("application/pdf"), { pollIntervalMs: 0 });
    expect(mock.requests).toHaveLength(3);
    expect(artifact.data.byteLength).toBe(PDF_BYTES.byteLength);
  });

  it("throws a pending error when the label never becomes ready", async () => {
    const { client, mock } = makeClient({ status: 202, body: "" });
    const err = (await client.artifacts
      .get(label("application/pdf"), { pollAttempts: 2, pollIntervalMs: 0 })
      .catch((e: unknown) => e)) as CanadaPostApiError;
    expect(err).toBeInstanceOf(CanadaPostApiError);
    expect(err.isPending).toBe(true);
    expect(mock.requests).toHaveLength(3);
  });

  it("maps an expired link (404 + messages) to an API error", async () => {
    const { client } = makeClient({
      status: 404,
      body: "<messages><message><code>404</code><description>Not found</description></message></messages>",
      headers: { "content-type": "application/xml" },
    });
    await expect(client.artifacts.get(label("application/pdf"))).rejects.toMatchObject({
      status: 404,
    });
  });

  it("maps an XML error delivered with HTTP 200 instead of a label", async () => {
    const { client } = makeClient({
      status: 200,
      body: "<messages><message><code>E1</code><description>invalid</description></message></messages>",
      headers: { "content-type": "application/xml" },
    });
    await expect(client.artifacts.get(label("application/pdf"))).rejects.toBeInstanceOf(
      CanadaPostApiError,
    );
  });

  it("refuses non-https targets and hosts outside the environment", async () => {
    const { client, mock } = makeClient({ body: "x" });
    await expect(client.artifacts.get("ftp://x/y")).rejects.toThrow(/https/);
    await expect(
      client.artifacts.get("https://evil.example.com/rs/artifact/1/2/0"),
    ).rejects.toBeInstanceOf(CanadaPostConfigurationError);
    // A production link must not be followed with sandbox credentials.
    await expect(
      client.artifacts.get("https://soa-gw.canadapost.ca/rs/artifact/1/2/0"),
    ).rejects.toBeInstanceOf(CanadaPostConfigurationError);
    expect(mock.requests).toHaveLength(0);
  });

  it("saveToFile writes the exact bytes, creating directories", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cp-sdk-"));
    dirs.push(dir);
    const { client } = makeClient({
      status: 200,
      body: PDF_BYTES,
      headers: { "content-type": "application/pdf" },
    });
    const path = join(dir, "nested", "label.pdf");
    const saved = await client.artifacts.saveToFile(label("application/pdf"), path);
    expect(saved).toEqual({ path, bytes: PDF_BYTES.byteLength, contentType: "application/pdf" });
    expect(Array.from(await readFile(path))).toEqual(Array.from(PDF_BYTES));
  });

  it("saveArtifact works on an already downloaded artifact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cp-sdk-"));
    dirs.push(dir);
    const path = join(dir, "label.zpl");
    const saved = await saveArtifact(
      { contentType: "application/zpl", data: new TextEncoder().encode("^XA^XZ") },
      path,
    );
    expect(saved.bytes).toBe(6);
    expect(await readFile(path, "utf8")).toBe("^XA^XZ");
  });
});

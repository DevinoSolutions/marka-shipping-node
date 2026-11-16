import { describe, expect, it } from "vitest";
import { describeConfig, loadConfigFromEnv, McpConfigError, writePolicy } from "../src/config.js";
import { parseCliArgs } from "../src/cli.js";
import { BASE_ENV, CLIENT_ID, SECRET } from "./support/harness.js";

const load = (extra: Record<string, string> = {}) => loadConfigFromEnv({ ...BASE_ENV, ...extra });

describe("configuration", () => {
  it("defaults to the Test app with writes off", () => {
    const config = load();
    expect(config.app).toBe("test");
    expect(config.allowWrites).toBe(false);
    expect(config.allowProductionWrites).toBe(false);
    expect(config.previewTtlSeconds).toBe(300);
    expect(config.previewHmacKey).toMatch(/^[0-9a-f]{64}$/);
    expect(config.outputDirRestricted).toBe(false);
    expect(writePolicy(config).enabled).toBe(false);
  });

  it("needs the three credentials, and names the missing one without echoing values", () => {
    for (const name of Object.keys(BASE_ENV)) {
      const env = { ...BASE_ENV };
      delete env[name];
      expect(() => loadConfigFromEnv(env)).toThrow(new RegExp(`${name} is required`));
    }
    expect(() => loadConfigFromEnv({ ...BASE_ENV, CANADAPOST_CLIENT_ID: "   " })).toThrow(
      McpConfigError,
    );
  });

  it("accepts only the exact values test and production for CANADAPOST_APP", () => {
    expect(load({ CANADAPOST_APP: "production" }).app).toBe("production");
    expect(load({ CANADAPOST_APP: "test" }).app).toBe("test");
    for (const bad of ["prod", "PRODUCTION", "live", "Test"]) {
      expect(() => load({ CANADAPOST_APP: bad })).toThrow(/CANADAPOST_APP must be/);
    }
  });

  it("parses booleans strictly", () => {
    expect(load({ CANADAPOST_MCP_ALLOW_WRITES: "true" }).allowWrites).toBe(true);
    expect(load({ CANADAPOST_MCP_ALLOW_WRITES: "false" }).allowWrites).toBe(false);
    expect(load({ CANADAPOST_MCP_ALLOW_WRITES: "" }).allowWrites).toBe(false);
    for (const bad of ["1", "yes", "TRUE", "True"]) {
      expect(() => load({ CANADAPOST_MCP_ALLOW_WRITES: bad })).toThrow(/must be "true" or "false"/);
      expect(() => load({ CANADAPOST_MCP_ALLOW_PRODUCTION_WRITES: bad })).toThrow(McpConfigError);
    }
  });

  it("validates the TTL, the HMAC key and the output directory", () => {
    expect(load({ CANADAPOST_MCP_PREVIEW_TTL_SECONDS: "60" }).previewTtlSeconds).toBe(60);
    for (const bad of ["10", "901", "abc", "60.5"]) {
      expect(() => load({ CANADAPOST_MCP_PREVIEW_TTL_SECONDS: bad })).toThrow(McpConfigError);
    }
    expect(() => load({ CANADAPOST_MCP_PREVIEW_HMAC_KEY: "short" })).toThrow(/at least 32/);
    expect(load({ CANADAPOST_MCP_PREVIEW_HMAC_KEY: "k".repeat(32) }).previewHmacKey).toBe(
      "k".repeat(32),
    );
    expect(() => load({ CANADAPOST_MCP_OUTPUT_DIR: "relative/dir" })).toThrow(/absolute/);
    expect(load({ CANADAPOST_MCP_OUTPUT_DIR: process.cwd() }).outputDirRestricted).toBe(true);
  });

  it("never reads the PROD credential variables", () => {
    const config = loadConfigFromEnv({
      ...BASE_ENV,
      CANADAPOST_PROD_CLIENT_ID: "fake-id-should-be-ignored",
      CANADAPOST_PROD_CLIENT_SECRET: "fake-secret-should-be-ignored",
    });
    expect(config.clientId).toBe(CLIENT_ID);
    expect(config.clientSecret).toBe(SECRET);
    expect(JSON.stringify(config)).not.toContain("should-be-ignored");
  });

  it("describes itself without any credential", () => {
    const text = JSON.stringify(describeConfig(load({ CANADAPOST_MCP_ALLOW_WRITES: "true" })));
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(CLIENT_ID);
    expect(text).not.toContain("1234567");
  });
});

describe("write policy", () => {
  const policy = (env: Record<string, string>) => writePolicy(load(env));

  it.each([
    ["test, writes off", {}, false],
    ["test, writes on", { CANADAPOST_MCP_ALLOW_WRITES: "true" }, true],
    ["test, only the production flag", { CANADAPOST_MCP_ALLOW_PRODUCTION_WRITES: "true" }, false],
    ["production, writes off", { CANADAPOST_APP: "production" }, false],
    [
      "production, writes on without the production flag",
      { CANADAPOST_APP: "production", CANADAPOST_MCP_ALLOW_WRITES: "true" },
      false,
    ],
    [
      "production, only the production flag",
      { CANADAPOST_APP: "production", CANADAPOST_MCP_ALLOW_PRODUCTION_WRITES: "true" },
      false,
    ],
    [
      "production, both flags",
      {
        CANADAPOST_APP: "production",
        CANADAPOST_MCP_ALLOW_WRITES: "true",
        CANADAPOST_MCP_ALLOW_PRODUCTION_WRITES: "true",
      },
      true,
    ],
  ])("%s -> enabled=%s", (_name, env, enabled) => {
    expect(policy(env).enabled).toBe(enabled);
  });

  it("says why writes are off", () => {
    expect(policy({}).reason).toMatch(/ALLOW_WRITES is not true/);
    expect(
      policy({ CANADAPOST_APP: "production", CANADAPOST_MCP_ALLOW_WRITES: "true" }).reason,
    ).toMatch(/PRODUCTION_WRITES/);
  });
});

describe("command line", () => {
  it("parses help and version and refuses anything else", () => {
    expect(parseCliArgs([])).toEqual({ help: false, version: false });
    expect(parseCliArgs(["--help"]).help).toBe(true);
    expect(parseCliArgs(["-v"]).version).toBe(true);
    expect(() => parseCliArgs(["--transport", "http"])).toThrow(/unknown argument/);
  });
});

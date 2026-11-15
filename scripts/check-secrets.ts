// Guards against committing credentials:
// 1. .gitignore must exclude .env
// 2. If a local .env exists, none of its secret values may appear in any scanned file
//    (including the Basic credential derived from the username/password pair, and the OAuth
//    client ids and secrets of the Test and Production apps).
// 3. Generic scan for credential-looking values next to Authorization / password / client
//    secret markers, hard-coded Bearer tokens and JWT-shaped values, label capability URLs
//    (`key-cle=`) and Zonos-style keys.
//
// IMPORTANT: the scan list is the WORKING TREE (`git ls-files -co --exclude-standard`,
// i.e. tracked + untracked-but-not-ignored files). Do NOT narrow this back to plain
// `git ls-files`: in a repo with nothing committed/staged that scans zero files and
// the check passes hollowly while secrets sit in soon-to-be-committed files.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
let failures = 0;
const fail = (msg: string): void => {
  failures += 1;
  console.error(`FAIL ${msg}`);
};

// Obvious placeholders used in docs, fixtures and tests. Real credentials never look like this.
const DOC_DUMMIES: ReadonlySet<string> = new Set([
  "YOUR_API_USERNAME",
  "YOUR_API_PASSWORD",
  "YOUR_CUSTOMER_NUMBER",
  "YOUR_CLIENT_ID",
  "YOUR_CLIENT_SECRET",
  "test-user",
  "test-password",
  "zonos-test-key",
]);

// Fake-looking values used by the mocked tests: real client secrets and tokens never start
// like this, so a fixture named `fake-access-token-1` must not trip the scan.
const isDummy = (value: string): boolean =>
  DOC_DUMMIES.has(value) ||
  /^(?:fake|test|mock|dummy|wrong)-/i.test(value) ||
  /EXAMPLE/.test(value);

const gitignore = existsSync(join(root, ".gitignore"))
  ? readFileSync(join(root, ".gitignore"), "utf8")
  : "";
if (!/^\.env$/m.test(gitignore)) fail(".gitignore does not exclude .env");

// Tracked + untracked-unignored — the set of files that could ever reach a commit.
const scanned = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], {
  cwd: root,
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter((f) => f && !f.startsWith("package-lock"));

// Values from the developer's real .env, plus the Basic credential the SDK derives from them —
// a leaked `base64(user:password)` is just as damaging as the raw pair.
const localSecrets: string[] = [];
if (existsSync(join(root, ".env"))) {
  let username: string | undefined;
  let password: string | undefined;
  for (const line of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(
      /^\s*CANADAPOST_(USERNAME|PASSWORD|CUSTOMER_NUMBER|CONTRACT_ID|CLIENT_ID|CLIENT_SECRET|PROD_CLIENT_ID|PROD_CLIENT_SECRET)\s*=\s*(.+?)\s*$/,
    );
    const key = m?.[1];
    const raw = m?.[2];
    if (key === undefined || raw === undefined) continue;
    const value = raw.replace(/^["']|["']$/g, "");
    if (value.length < 4 || isDummy(value)) continue;
    if (key === "USERNAME") username = value;
    else if (key === "PASSWORD") password = value;
    localSecrets.push(value);
  }
  if (username !== undefined && password !== undefined) {
    localSecrets.push(Buffer.from(`${username}:${password}`, "utf8").toString("base64"));
  }
}

for (const file of scanned) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue; // binary
  }
  for (const secret of localSecrets) {
    if (text.includes(secret)) fail(`${file} contains a value from your local .env`);
  }
  // A hardcoded Basic credential.
  for (const m of text.matchAll(/Authorization["'\s:=]+Basic\s+([A-Za-z0-9+/=]{16,})/g)) {
    const value = m[1];
    if (value !== undefined)
      fail(`${file} contains a hardcoded Basic credential: ${value.slice(0, 6)}…`);
  }
  // A hardcoded Bearer token (an OAuth access token) or a JWT-shaped value.
  for (const m of text.matchAll(/Authorization["'\s:=]+Bearer\s+([A-Za-z0-9\-._~+/]{20,}=*)/g)) {
    const value = m[1];
    if (value !== undefined && !isDummy(value))
      fail(`${file} contains a hardcoded Bearer token: ${value.slice(0, 6)}…`);
  }
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g)) {
    fail(`${file} contains a JWT-shaped token: ${m[0].slice(0, 8)}…`);
  }
  // Capability URLs and partner keys that appear in API responses: never commit those.
  for (const m of text.matchAll(/key-cle=([A-Za-z0-9]{12,})/g)) {
    if (!isDummy(m[1] ?? "")) fail(`${file} contains a label capability URL (key-cle=…)`);
  }
  for (const m of text.matchAll(/credential_(?:live|test)_[0-9a-f-]{20,}/g)) {
    if (!isDummy(m[0])) fail(`${file} contains a Zonos-style credential: ${m[0].slice(0, 16)}…`);
  }
  // A long opaque LITERAL assigned to a credential-shaped name. The value must be quoted:
  // `password: process.env.CANADAPOST_PASSWORD` is how the code is supposed to read it, and
  // flagging that would train everyone to ignore this check.
  for (const m of text.matchAll(
    /(?:password|apiKey|api_key|api-key|CANADAPOST_PASSWORD|X-CPC-Zonos-Key|client_secret|clientSecret|CLIENT_SECRET|access_token|accessToken)["']?\s*[:=]\s*["'`]([A-Za-z0-9_\-.+/=]{20,})["'`]/gi,
  )) {
    const value = m[1];
    if (value !== undefined && !isDummy(value))
      fail(`${file} contains a secret-looking literal: ${value.slice(0, 6)}…`);
  }
  // A raw value in an env-file-shaped assignment (e.g. a real secret pasted into .env.example).
  for (const m of text.matchAll(
    /^\s*CANADAPOST_(?:USERNAME|PASSWORD|CLIENT_ID|CLIENT_SECRET|PROD_CLIENT_ID|PROD_CLIENT_SECRET)\s*=\s*(\S{20,})\s*$/gm,
  )) {
    const value = m[1]?.replace(/^["']|["']$/g, "");
    if (value !== undefined && value.length >= 20 && !isDummy(value))
      fail(`${file} assigns a credential-looking value to a CANADAPOST_* credential variable`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} secret check(s) failed`);
  process.exit(1);
}
console.log(`Secret checks passed (${scanned.length} files scanned)`);

import { mkdir, open } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import type { RestArtifact } from "@joinmarka/canada-post";
import { businessError, type ToolErrorPayload } from "./shared.js";

/** A label saved to disk. The bytes never go through the MCP channel. */
interface SavedArtifact {
  path: string;
  bytes: number;
  contentType: string;
}

const EXTENSION: Record<string, string> = { "application/pdf": ".pdf", "application/zpl": ".zpl" };

/** Thrown with a ready payload when the requested path is not acceptable. */
export class ArtifactPathError extends Error {
  constructor(readonly payload: ToolErrorPayload) {
    super(payload.message);
  }
}

function insideDirectory(dir: string, target: string): boolean {
  const rel = relative(dir, target);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Saves a label. With no `requestedPath` it goes into `outputDir` under a generated name.
 * A caller-given path must be absolute, carry the right extension, lie inside `outputDir` when
 * the operator set `CANADAPOST_MCP_OUTPUT_DIR`, and must not exist yet: nothing is overwritten.
 */
export async function saveArtifact(
  artifact: RestArtifact,
  options: {
    outputDir: string;
    restrictToOutputDir: boolean;
    baseName: string;
    requestedPath?: string;
    now: number;
  },
): Promise<SavedArtifact> {
  const extension = EXTENSION[artifact.contentType];
  if (extension === undefined) {
    throw new ArtifactPathError(
      businessError("unsupported_content_type", `cannot save ${artifact.contentType}`),
    );
  }
  let target: string;
  if (options.requestedPath === undefined) {
    const safeBase = options.baseName.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48);
    target = resolve(options.outputDir, `${safeBase}-${options.now.toString(36)}${extension}`);
  } else {
    if (!isAbsolute(options.requestedPath)) {
      throw new ArtifactPathError(businessError("invalid_path", "path must be absolute"));
    }
    target = resolve(options.requestedPath);
    if (extname(target).toLowerCase() !== extension) {
      throw new ArtifactPathError(
        businessError("invalid_path", `the file name must end with ${extension}`),
      );
    }
    if (options.restrictToOutputDir && !insideDirectory(options.outputDir, target)) {
      throw new ArtifactPathError(
        businessError("invalid_path", "path must be inside CANADAPOST_MCP_OUTPUT_DIR"),
      );
    }
  }
  await mkdir(dirname(target), { recursive: true });
  let handle;
  try {
    // "wx": fail instead of overwriting an existing file.
    handle = await open(target, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ArtifactPathError(
        businessError("file_exists", `${basename(target)} already exists; choose another path`),
      );
    }
    throw error;
  }
  try {
    await handle.writeFile(artifact.data);
  } finally {
    await handle.close();
  }
  return { path: target, bytes: artifact.data.byteLength, contentType: artifact.contentType };
}

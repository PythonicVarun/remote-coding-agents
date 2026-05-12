import fs from "node:fs/promises";
import path from "node:path";
import { badRequest } from "../lib/errors.js";

export interface FsNode {
  name: string;
  /** Path relative to the project root, POSIX separators. */
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: string;
  children?: FsNode[];
}

const ALWAYS_HIDE = new Set([".git", "node_modules", ".venv", "__pycache__"]);

/** Reject paths that escape the project root via .. or absolute prefixes. */
export function resolveSafe(projectPath: string, relative: string): string {
  const normalized = path
    .normalize(relative || ".")
    .replace(/^([/\\]+)/, "");
  const resolved = path.resolve(projectPath, normalized);
  const rel = path.relative(projectPath, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw badRequest("path escapes project root");
  }
  return resolved;
}

export async function readTree(
  projectPath: string,
  opts: { maxDepth?: number } = {},
): Promise<FsNode> {
  const maxDepth = opts.maxDepth ?? 6;
  const rootStat = await fs.stat(projectPath);
  const root: FsNode = {
    name: path.basename(projectPath),
    path: "",
    type: "directory",
    modified: rootStat.mtime.toISOString(),
    children: [],
  };
  await walk(projectPath, projectPath, root, 0, maxDepth);
  return root;
}

async function walk(
  projectRoot: string,
  current: string,
  node: FsNode,
  depth: number,
  maxDepth: number,
): Promise<void> {
  if (depth >= maxDepth) return;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (ALWAYS_HIDE.has(entry.name)) continue;
    const full = path.join(current, entry.name);
    const rel = path.relative(projectRoot, full).split(path.sep).join("/");

    if (entry.isDirectory()) {
      const child: FsNode = {
        name: entry.name,
        path: rel,
        type: "directory",
        children: [],
      };
      node.children!.push(child);
      // eslint-disable-next-line no-await-in-loop
      await walk(projectRoot, full, child, depth + 1, maxDepth);
    } else if (entry.isFile()) {
      let size: number | undefined;
      let modified: string | undefined;
      try {
        const st = await fs.stat(full);
        size = st.size;
        modified = st.mtime.toISOString();
      } catch {
        /* ignore */
      }
      node.children!.push({
        name: entry.name,
        path: rel,
        type: "file",
        size,
        modified,
      });
    }
  }
}

export async function readFileSafe(
  projectPath: string,
  relative: string,
  maxBytes = 256 * 1024,
): Promise<{ content: string; truncated: boolean; size: number }> {
  const abs = resolveSafe(projectPath, relative);
  const st = await fs.stat(abs);
  if (!st.isFile()) throw badRequest("not a file");
  const truncated = st.size > maxBytes;
  const handle = await fs.open(abs, "r");
  try {
    const buf = Buffer.alloc(Math.min(st.size, maxBytes));
    await handle.read(buf, 0, buf.length, 0);
    return { content: buf.toString("utf8"), truncated, size: st.size };
  } finally {
    await handle.close();
  }
}

/**
 * Write `data` to <projectPath>/<relDir>/<name>. The destination directory must
 * already exist and the resulting path must stay inside the project root. The
 * filename itself may not contain path separators or `..`.
 */
export async function writeFileSafe(
  projectPath: string,
  relDir: string,
  name: string,
  data: Buffer,
): Promise<{ path: string; size: number }> {
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) {
    throw badRequest("invalid filename");
  }
  const dirAbs = resolveSafe(projectPath, relDir);
  const dirStat = await fs.stat(dirAbs).catch(() => null);
  if (!dirStat || !dirStat.isDirectory()) {
    throw badRequest("target is not a directory");
  }
  const fileAbs = path.join(dirAbs, name);
  // Defence-in-depth: re-check we didn't escape via the joined filename.
  const rel = path.relative(projectPath, fileAbs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw badRequest("path escapes project root");
  }
  await fs.writeFile(fileAbs, data);
  const st = await fs.stat(fileAbs);
  return { path: rel.split(path.sep).join("/"), size: st.size };
}

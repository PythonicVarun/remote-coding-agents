import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

async function chmodEntry(targetPath: string, isDirectory: boolean): Promise<void> {
  if (os.platform() === "win32") return;
  await fs.chmod(targetPath, isDirectory ? 0o777 : 0o666);
}

export async function ensureProjectTreeWritable(projectPath: string): Promise<void> {
  if (os.platform() === "win32") return;

  const stack = [projectPath];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(current);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      await chmodEntry(current, true);
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        stack.push(path.join(current, entry.name));
      }
    } else if (stat.isFile()) {
      await chmodEntry(current, false);
    }
  }
}

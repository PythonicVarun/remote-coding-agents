// Send a chat message into a running session's tmux pane.
//
// The agent container starts the agent inside a tmux session named "agent".
// `tmux send-keys -l "<text>"` writes the literal text (no escape parsing),
// then a second call sends Enter so the agent receives a complete line.

import { docker } from "./docker.js";
import { badRequest, notFound } from "../lib/errors.js";

async function execAndWait(
  containerId: string,
  cmd: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const container = docker.getContainer(containerId);
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
  });
  const stream = await exec.start({ hijack: true, stdin: false });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  // Docker multiplexes stdout/stderr in a header-framed stream when TTY=false.
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer) => {
      let offset = 0;
      while (offset + 8 <= chunk.length) {
        const streamType = chunk[offset];
        const size = chunk.readUInt32BE(offset + 4);
        const payload = chunk.subarray(offset + 8, offset + 8 + size);
        if (streamType === 1) stdoutChunks.push(payload);
        else if (streamType === 2) stderrChunks.push(payload);
        offset += 8 + size;
      }
    });
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });

  const info = await exec.inspect();
  return {
    exitCode: info.ExitCode ?? 0,
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8"),
  };
}

export async function sendChatToSession(containerId: string, text: string): Promise<void> {
  const cleaned = text.replace(/\r/g, "");
  if (cleaned.length === 0) throw badRequest("empty message");
  if (cleaned.length > 8000) throw badRequest("message too long (max 8000 chars)");

  // Send the literal text, then Enter. -l means "literal" — no key parsing.
  const lit = await execAndWait(containerId, [
    "tmux",
    "send-keys",
    "-t",
    "agent",
    "-l",
    cleaned,
  ]);
  if (lit.exitCode !== 0) {
    if (/can't find session/i.test(lit.stderr)) {
      throw notFound("agent tmux session not running");
    }
    throw new Error(`tmux send-keys failed: ${lit.stderr.trim() || lit.stdout.trim()}`);
  }
  const enter = await execAndWait(containerId, [
    "tmux",
    "send-keys",
    "-t",
    "agent",
    "Enter",
  ]);
  if (enter.exitCode !== 0) {
    throw new Error(`tmux send-keys Enter failed: ${enter.stderr.trim()}`);
  }
}

// Send a chat message into a running session's tmux pane.
//
// The agent container starts the agent inside a tmux session named "agent".
// `tmux send-keys -l "<text>"` writes the literal text (no escape parsing),
// then a second call sends Enter so the agent receives a complete line.

import { execInContainer } from "./docker.js";
import { badRequest, notFound } from "../lib/errors.js";

export async function sendChatToSession(containerId: string, text: string): Promise<void> {
  const cleaned = text.replace(/\r/g, "");
  if (cleaned.length === 0) throw badRequest("empty message");
  if (cleaned.length > 8000) throw badRequest("message too long (max 8000 chars)");

  // Send the literal text, then Enter. -l means "literal" — no key parsing.
  const lit = await execInContainer(containerId, [
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
  const enter = await execInContainer(containerId, [
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

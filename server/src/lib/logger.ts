// Tiny structured logger. Enough for this app — swap for pino later if needed.

type Level = "debug" | "info" | "warn" | "error";

const levelOrder: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = levelOrder[(process.env.LOG_LEVEL as Level) ?? "info"] ?? levelOrder.info;

function emit(level: Level, scope: string, msg: string, meta?: Record<string, unknown>) {
  if (levelOrder[level] < threshold) return;
  const line = {
    t: new Date().toISOString(),
    level,
    scope,
    msg,
    ...(meta ?? {}),
  };
  const out = level === "error" || level === "warn" ? console.error : console.log;
  out(JSON.stringify(line));
}

export function logger(scope: string) {
  return {
    debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", scope, msg, meta),
    info: (msg: string, meta?: Record<string, unknown>) => emit("info", scope, msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", scope, msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) => emit("error", scope, msg, meta),
  };
}

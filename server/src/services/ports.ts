import net from "node:net";
import { config } from "../config.js";
import { serverError } from "../lib/errors.js";

const inUse = new Set<number>();

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => {
        tester.close(() => resolve(true));
      })
      .listen(port, "127.0.0.1");
  });
}

export async function allocatePort(): Promise<number> {
  for (let p = config.ttydPortMin; p <= config.ttydPortMax; p += 1) {
    if (inUse.has(p)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(p)) {
      inUse.add(p);
      return p;
    }
  }
  throw serverError(`no free port in ${config.ttydPortMin}-${config.ttydPortMax}`);
}

export function releasePort(port: number | undefined): void {
  if (typeof port === "number") inUse.delete(port);
}

export function reservePort(port: number): void {
  inUse.add(port);
}

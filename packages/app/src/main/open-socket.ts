import { createServer, type Server, type Socket } from "node:net";
import { unlinkSync } from "node:fs";
import type { OpenTarget } from "@gander/shared";
import { parseOpenTarget } from "./cli.js";

/**
 * The channel `bin/gander` uses to hand a running app a review to open.
 *
 * One socket per checkout, so a command run in a worktree reaches that worktree's
 * window — the same pairing the port, token, and database already have. Electron's
 * single-instance lock cannot do this: it is keyed on the user data directory, which
 * every checkout deliberately shares so they can reuse each other's clones.
 *
 * The client stays dumb and sends its raw argv; the parsing, and any complaint about
 * it, happens here, where `parseOpenTarget` already lives.
 */

interface OpenServerOptions {
  socketPath: string;
  onTarget(target: OpenTarget): void;
}

function readRequest(raw: string): string[] {
  const body: unknown = JSON.parse(raw);
  if (typeof body !== "object" || body === null) throw new Error("expected a JSON object");
  const argv = (body as { argv?: unknown }).argv;
  if (!Array.isArray(argv) || argv.some((a) => typeof a !== "string")) {
    throw new Error("expected an argv array of strings");
  }
  return argv as string[];
}

function handle(socket: Socket, onTarget: (target: OpenTarget) => void): void {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    // One request per connection, terminated by a newline: a socket write can arrive in
    // any number of chunks, so the boundary has to be in the message rather than assumed.
    const end = buffer.indexOf("\n");
    if (end === -1) return;
    const line = buffer.slice(0, end);
    buffer = "";
    try {
      const target = parseOpenTarget(readRequest(line));
      if (target === null) throw new Error("no repository named: pass --repo owner/name");
      onTarget(target);
      socket.end(`${JSON.stringify({ ok: true, target })}\n`);
    } catch (err) {
      socket.end(`${JSON.stringify({ error: (err as Error).message })}\n`);
    }
  });
  // A client that dies mid-request must not take the app down with it.
  socket.on("error", () => socket.destroy());
}

/** Starts listening, and returns a function that stops and cleans up. */
export function startOpenServer(opts: OpenServerOptions): Promise<() => void> {
  return new Promise((resolve, reject) => {
    // A crash leaves the socket file behind; without this every launch after one would
    // fail to listen with EADDRINUSE.
    try { unlinkSync(opts.socketPath); } catch { /* not there, which is the normal case */ }

    const server: Server = createServer((socket) => handle(socket, opts.onTarget));
    server.once("error", reject);
    server.listen(opts.socketPath, () => {
      server.removeListener("error", reject);
      server.on("error", () => { /* a failed connection is not worth crashing the app over */ });
      resolve(() => {
        server.close();
        try { unlinkSync(opts.socketPath); } catch { /* already gone */ }
      });
    });
  });
}

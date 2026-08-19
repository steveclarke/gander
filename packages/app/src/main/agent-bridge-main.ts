import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createAgentBridge } from "./agent-bridge.js";

const serviceUrl = process.env.GANDER_SERVICE_URL;
const token = process.env.GANDER_TOKEN;
if (serviceUrl === undefined || token === undefined) {
  console.error("GANDER_SERVICE_URL and GANDER_TOKEN are required");
  process.exit(2);
}

const bridges: Array<{ close(): Promise<void> }> = [];
const handle = serveStdio(async () => {
  const bridge = await createAgentBridge({
    serviceUrl,
    token,
    version: "0.1.4",
  });
  bridges.push(bridge);
  bridge.server.server.onclose = () => void bridge.close();
  return bridge.server;
}, {
  // The local host-facing side follows the protocol the installed agent uses;
  // createAgentBridge pins its upstream service connection to 2026-07-28.
  legacy: "serve",
  maxSubscriptions: 4,
  onerror: (error) => console.error(`Gander agent bridge: ${error.message}`),
});

async function close(): Promise<void> {
  await handle.close();
  await Promise.all(bridges.map((bridge) => bridge.close()));
}

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());

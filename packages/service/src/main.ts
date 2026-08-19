import { openStorage } from "./storage.js";
import { buildServer } from "./server.js";
import { SERVICE_VERSION } from "@gander/shared";

const port = Number(process.env.GANDER_PORT ?? 8390);
const host = process.env.GANDER_HOST ?? "127.0.0.1";
const dbPath = process.env.GANDER_DB ?? "gander.db";
const token = process.env.GANDER_TOKEN;
if (!token) { console.error("GANDER_TOKEN is required"); process.exit(1); }

const storage = openStorage(dbPath);
const server = buildServer({ storage, token, version: SERVICE_VERSION });
server.listen({ port, host }).then(() => console.log(`gander service on http://${host}:${port}`));

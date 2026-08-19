import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

const outputPath = process.env.GANDER_CODEX_SESSION_FILE;
if (outputPath === undefined) {
  console.error("GANDER_CODEX_SESSION_FILE is required");
  process.exit(2);
}

// Codex may start internal auto-review sessions after the main session. The
// launcher creates an empty file, so only the first SessionStart owns it.
if (existsSync(outputPath) && readFileSync(outputPath, "utf8").trim() !== "") {
  process.exit(0);
}

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));

const event = z.object({ session_id: z.string().min(20).max(128) }).parse(
  JSON.parse(Buffer.concat(chunks).toString("utf8")),
);
writeFileSync(outputPath, `${event.session_id}\n`, { mode: 0o600 });

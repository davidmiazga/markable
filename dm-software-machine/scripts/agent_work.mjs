import { readFileSync } from "node:fs";
import { Agent, Cursor, CursorAgentError } from "@cursor/sdk";

const promptPath = process.argv[2];
if (!promptPath) {
  process.stderr.write("agent prompt file is missing\n");
  process.exit(1);
}

const prompt = readFileSync(promptPath, "utf8");

try {
  if (!process.env.CURSOR_API_KEY) {
    const status = await Cursor.auth.status();
    if (status.status !== "logged-in") {
      process.stderr.write("Opening Cursor login so the agent can start.\n");
      await Cursor.auth.login({ apiKeyName: "dm-software-machine" });
    }
  }
  const result = await Agent.prompt(prompt, {
    model: { id: "auto" },
    local: {
      cwd: process.cwd(),
      settingSources: ["project", "user"],
    },
  });
  if (result.status !== "finished") {
    const message = result.error?.message || result.status || "agent did not finish";
    process.stderr.write(`${message}\n`);
    process.exit(2);
  }
} catch (err) {
  const message = err instanceof CursorAgentError ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

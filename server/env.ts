/**
 * Loads .env.local, then .env (the files Next.js reads) into process.env, for the
 * game server and the scripts that use its settings. Like Next.js, anything already
 * set in the real environment (Render's Environment, or `$env:X="…"` in PowerShell)
 * wins, so `$env:DATABASE_URL="off"` runs without the database even when .env.local has one.
 */
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export function loadEnvFiles(files = [".env.local", ".env"]) {
  for (const file of files) {
    try {
      const fromFile = parseEnv(readFileSync(file, "utf8"));
      for (const [key, value] of Object.entries(fromFile)) if (process.env[key] === undefined) process.env[key] = value;
    } catch {
      // No such file: defaults it is.
    }
  }
}

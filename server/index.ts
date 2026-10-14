/**
 * The Hermes Quiz game server: runs the whole quiz (this is the backend that's deployed) so the frontend can be built and
 * tested without the real backend. Started by `npm run dev`.
 *
 * Pick the preset with `--preset event` (npm run dev:event does this) or the
 * GAME_PRESET environment variable.
 *
 * Environment (all optional):
 *   GAME_PRESET     demo (default) or event
 *   ADMIN_PIN       quizmaster PIN for /admin (default 1234; required when GAME_PRESET=event,
 *                   unless ALLOW_DEFAULT_PIN=1 for a local rehearsal)
 *   GAME_PORT       default: PORT (set by Render), else 3001
 *   WEB_PORT        default 3000 (only used to print the right links)
 *   PUBLIC_WEB_URL  the site's address once deployed (for the join link)
 *   CORS_ORIGIN     comma-separated allowed origins (default: any)
 *   DATABASE_URL    Postgres (Supabase) connection string: saves rooms, scores and
 *                   every Round 1 answer to the backend tables (db.ts). Unset = memory only.
 *   In-game defaults (ROUND1_READ_SECONDS, ROUND1_ANSWER_SECONDS, MULTI_ANSWER_SECONDS,
 *   BLACKOUT_READ_SECONDS, … : GAME_ENV in config.ts, documented in .env.example).
 *
 * Read from the real environment first (Render), then .env.local, then .env (like Next.js).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { type GameConfig, gameEnvInUse, loadConfig } from "./config";
import { Database } from "./db";
import { loadEnvFiles } from "./env";
import { FINAL_QUIZ_FILE } from "./finalQuiz";
import { FileLibrary, PostgresLibrary } from "./library";
import { getLanAddresses } from "./network";
import { loadQuestions } from "./questions";
import { startGameServer } from "./server";

// Settings from .env.local, then .env (the files Next.js reads). The real environment wins.
loadEnvFiles();

const presetFlag = process.argv.indexOf("--preset");
let config: GameConfig;
try {
  config = loadConfig(presetFlag !== -1 ? process.argv[presetFlag + 1] : undefined);
} catch (error) {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
// Render (and most hosts) say which port to use in PORT.
const GAME_PORT = Number(process.env.GAME_PORT ?? process.env.PORT ?? 3001);
const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);
const ADMIN_PIN = process.env.ADMIN_PIN ?? "1234";

// On the night (GAME_PRESET=event, as on Render) the default PIN would let anyone run the quiz:
// refuse to start with it unless ALLOW_DEFAULT_PIN=1 (a local rehearsal). `npm run dev:event` passes
// --preset event instead and is exempt.
if (process.env.GAME_PRESET?.trim().toLowerCase() === "event" && ADMIN_PIN === "1234" && process.env.ALLOW_DEFAULT_PIN !== "1") {
  console.error(
    [
      "",
      "  GAME_PRESET=event needs a real quizmaster PIN: set ADMIN_PIN (not 1234).",
      "  For a local rehearsal only, set ALLOW_DEFAULT_PIN=1.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const lanIp = getLanAddresses()[0] ?? "localhost";
const webUrl = (process.env.PUBLIC_WEB_URL ?? `http://${lanIp}:${WEB_PORT}`).replace(/\/$/, "");
const joinUrl = `${webUrl}/play`;

// Fail fast, with a readable message, if the question file (the Demo quiz's source) is broken.
// final_quiz.json (the night's questions) is checked the same way when the server starts below.
try {
  loadQuestions();
} catch (error) {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
const finalQuizFile = existsSync(FINAL_QUIZ_FILE) ? FINAL_QUIZ_FILE : null;

// On the night, one unexpected error must not take every room (all in memory) down with it:
// log it loudly and keep serving. Startup problems still exit (they're handled before this matters).
let started = false;
process.on("uncaughtException", (error) => {
  console.error(`\n  [error] uncaught: ${error.stack ?? error.message}\n`);
  if (!started) process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error(`\n  [error] unhandled promise rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}\n`);
});

const log = (message: string) => console.log(`  ${message}`);
const database = Database.fromEnv(log);
// Quizzes live in Supabase when it's connected; otherwise in data/library/ (git-ignored).
const library = database ? new PostgresLibrary(database) : new FileLibrary(path.join(process.cwd(), "data", "library"));

startGameServer({
  port: GAME_PORT,
  config,
  adminPin: ADMIN_PIN,
  joinUrl,
  corsOrigin: process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean),
  log,
  database,
  library,
  finalQuizFile,
})
  .then(async ({ port, library }) => {
    started = true;
    const local = `http://localhost:${WEB_PORT}`;
    const quizzes = (await library.list()).length;
    console.log(
      [
        "",
        `  Hermes Quiz game server on port ${port}`,
        `  Quiz library: ${quizzes} quiz${quizzes === 1 ? "" : "zes"} (${database ? "Supabase" : "data/library/"}); defaults from the ${config.name} preset`,
        `  Results database: ${database ? "on (DATABASE_URL)" : "off (set DATABASE_URL to save to Postgres/Supabase)"}`,
        `  Game settings from the environment: ${gameEnvInUse().join(", ") || "none (the preset's)"}`,
        `  Times: Round 1 / wild card ${config.round1.readMs / 1000}s read + ${config.round1.answerMs / 1000}s answer (multi-correct ${config.round1.multiAnswerMs / 1000}s), Blackout ${config.blackout.readMs / 1000}s + ${config.blackout.answerMs / 1000}s; ${config.safe} safe at the cut`,
        "",
        `  Admin:             ${local}/admin   (PIN ${ADMIN_PIN === "1234" ? "1234" : "from ADMIN_PIN"}): open a room`,
        `  Host (projector):  ${local}/host    (same PIN)`,
        `  Participants:      ${joinUrl}   (phones on the same Wi-Fi)`,
        "",
      ].join("\n"),
    );
  })
  .catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`\n  Port ${GAME_PORT} is already in use. Is another "npm run dev" still running? Close it and try again.\n`);
    } else {
      // e.g. final_quiz.json has a problem: the message lists every one.
      console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exit(1);
  });

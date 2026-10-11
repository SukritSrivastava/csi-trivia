/**
 * MOCK game server: runs the whole quiz so the frontend can be built and
 * tested without the real backend. Started by `npm run dev`.
 *
 * Pick the preset with `--preset event` (npm run dev:event does this) or the
 * GAME_PRESET environment variable.
 *
 * Environment (all optional):
 *   GAME_PRESET     demo (default) or event
 *   ADMIN_PIN       quizmaster PIN for /admin (default 1234)
 *   GAME_PORT       default 3001
 *   WEB_PORT        default 3000 (only used to print the right links)
 *   PUBLIC_WEB_URL  the site's address once deployed (for the join link)
 *   CORS_ORIGIN     comma-separated allowed origins (default: any)
 */
import { type GameConfig, loadConfig } from "./config";
import { getLanAddresses } from "./network";
import { loadQuestions, pickRound1 } from "./questions";
import { startGameServer } from "./server";

// Settings from .env.local (the same file Next.js reads), if there is one.
try {
  process.loadEnvFile?.(".env.local");
} catch {
  // No .env.local: defaults it is.
}

const presetFlag = process.argv.indexOf("--preset");
let config: GameConfig;
try {
  config = loadConfig(presetFlag !== -1 ? process.argv[presetFlag + 1] : undefined);
} catch (error) {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
const GAME_PORT = Number(process.env.GAME_PORT ?? 3001);
const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);
const ADMIN_PIN = process.env.ADMIN_PIN ?? "1234";

const lanIp = getLanAddresses()[0] ?? "localhost";
const webUrl = (process.env.PUBLIC_WEB_URL ?? `http://${lanIp}:${WEB_PORT}`).replace(/\/$/, "");
const joinUrl = `${webUrl}/play`;

// Fail fast, with a readable message, if the question file is broken.
let round1Count = 0;
try {
  round1Count = pickRound1(loadQuestions(), config.round1.questions).length;
} catch (error) {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

startGameServer({
  port: GAME_PORT,
  config,
  adminPin: ADMIN_PIN,
  joinUrl,
  corsOrigin: process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()).filter(Boolean),
  log: (message) => console.log(`  ${message}`),
})
  .then(({ port }) => {
    const local = `http://localhost:${WEB_PORT}`;
    console.log(
      [
        "",
        `  Hermes Quiz mock game server on port ${port}`,
        `  ${config.name} preset: ${round1Count} Round 1 questions, top ${config.finalists}, ${config.round2.questions} buzzer questions`,
        "",
        `  Host (projector):  ${local}/host`,
        `  Admin:             ${local}/admin   (PIN ${ADMIN_PIN})`,
        `  Participants:      ${joinUrl}   (phones on the same Wi-Fi)`,
        "",
      ].join("\n"),
    );
  })
  .catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`\n  Port ${GAME_PORT} is already in use. Is another "npm run dev" still running? Close it and try again.\n`);
    } else {
      console.error(error);
    }
    process.exit(1);
  });

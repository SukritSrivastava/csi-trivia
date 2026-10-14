/**
 * The game server for `npm run bot-load-test`, in a process of its own so its CPU
 * and memory can be measured apart from the bots. Started by bot-load-test.ts
 * (child_process.fork); reports over IPC: { type: "ready", port }, a "stats"
 * sample every second, every log line, and any uncaught error.
 */
import { FINAL_QUIZ_FILE } from "../server/finalQuiz";
import { PRESETS } from "../server/config";
import { startGameServer } from "../server/server";

const send = (message: object) => process.send?.(message);
const scale = Number(process.env.LOAD_TEST_SPEED ?? "1");

process.on("uncaughtException", (e) => send({ type: "error", message: `uncaught: ${e.stack ?? e.message}` }));
process.on("unhandledRejection", (e) => send({ type: "error", message: `unhandled rejection: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}` }));

startGameServer({
  port: 0,
  host: "127.0.0.1",
  config: PRESETS.event,
  adminPin: process.env.LOAD_TEST_PIN ?? "4321",
  joinUrl: "http://localhost:3000/play",
  finalQuizFile: FINAL_QUIZ_FILE,
  timingScale: scale === 1 ? undefined : scale,
  log: (line) => send({ type: "log", line }),
}).then(
  ({ port }) => send({ type: "ready", port }),
  (e) => {
    send({ type: "error", message: `start failed: ${e instanceof Error ? e.message : String(e)}` });
    process.exit(1);
  },
);

let lastCpu = process.cpuUsage();
let lastAt = performance.now();
setInterval(() => {
  const cpu = process.cpuUsage(lastCpu);
  const now = performance.now();
  const mem = process.memoryUsage();
  send({ type: "stats", cpu: ((cpu.user + cpu.system) / 1000 / (now - lastAt)) * 100, rss: mem.rss, heap: mem.heapUsed });
  lastCpu = process.cpuUsage();
  lastAt = now;
}, 1000);

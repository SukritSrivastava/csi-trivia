/**
 * Fake participants, for testing with a full room:
 *
 *   npm run bots -- --room ABCD --count 80
 *
 * Options:
 *   --room ABCD       room code from the Host screen (required)
 *   --count 20        how many bots (default 20)
 *   --url http://localhost:3001   game server (default: this computer)
 *   --prefix Bot      name prefix (default "Bot"), names are "Bot 01", "Bot 02", ...
 *   --buzz 0.6        chance a finalist bot buzzes on a question (default 0.6)
 *   --miss 0.1        chance a bot doesn't answer a Round 1 question (default 0.1)
 *
 * Bots join a few at a time, answer at random speeds, buzz at random if they
 * make the final, and back a random finalist. If the game server restarts they
 * reconnect and rejoin. Stop them with Ctrl+C.
 */
import { io, type Socket } from "socket.io-client";
import {
  type ClientToServerEvents,
  JOIN_ERROR_MESSAGES,
  type JoinResult,
  type ParticipantView,
  type ServerToClientEvents,
} from "../src/shared/protocol";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.split("=")[1] : fallback;
}

const room = arg("room")?.toUpperCase();
const count = Math.max(1, Math.min(200, Number(arg("count", "20"))));
const url = arg("url", process.env.GAME_URL ?? "http://localhost:3001")!;
const prefix = arg("prefix", "Bot")!;
const buzzChance = Number(arg("buzz", "0.6"));
const missChance = Number(arg("miss", "0.1"));

if (!room) {
  console.error("\n  Usage: npm run bots -- --room ABCD --count 80\n  (the room code is on the Host screen)\n");
  process.exit(1);
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];

class Bot {
  socket: Client;
  participantId: string | null = null;
  view: ParticipantView | null = null;
  /** Question / buzz-window ids this bot already acted on. */
  private handled = new Set<string>();
  private timers = new Set<NodeJS.Timeout>();

  constructor(readonly name: string) {
    this.socket = io(url, { transports: ["websocket"], reconnectionDelayMax: 3000 });
    this.socket.on("connect", () => this.join());
    this.socket.on("participant:state", (view) => {
      this.view = view;
      this.react(view);
    });
    this.socket.on("room:closed", ({ reason }) => {
      console.log(`  ${this.name}: room closed (${reason})`);
      this.stop();
    });
  }

  private join() {
    this.socket.emit(
      "participant:join",
      { roomCode: room!, name: this.name, participantId: this.participantId ?? undefined },
      (result: JoinResult) => {
        if (result.ok) {
          this.participantId = result.participantId;
          return;
        }
        if (result.error === "room-not-found") {
          console.error(`\n  ${JOIN_ERROR_MESSAGES[result.error]} (room "${room}" at ${url})\n`);
          process.exit(1);
        }
        console.log(`  ${this.name} couldn't join: ${JOIN_ERROR_MESSAGES[result.error]}`);
        this.stop();
      },
    );
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private react(view: ParticipantView) {
    const s = view.screen;
    if (view.paused) return;

    if (s.kind === "answer" && !this.handled.has(s.questionId)) {
      this.handled.add(s.questionId);
      if (Math.random() < missChance) return;
      const msLeft = view.timer ? view.timer.endsAt - view.serverNow : 6000;
      this.later(rand(300, Math.max(400, msLeft - 300)), () => {
        const now = this.view?.screen;
        if (now?.kind !== "answer" || now.questionId !== s.questionId) return;
        this.socket.emit("participant:answer", { questionId: s.questionId, optionId: pick(now.options).id });
      });
    }

    if (s.kind === "buzzer" && s.canBuzz && s.questionId) {
      // One decision per buzz window (a reopened window is a new chance).
      const key = `${s.questionId}:${s.wrong.length}`;
      if (this.handled.has(key)) return;
      this.handled.add(key);
      if (Math.random() > buzzChance) return;
      this.later(rand(400, 6000), () => {
        const now = this.view?.screen;
        if (now?.kind === "buzzer" && now.canBuzz && now.questionId === s.questionId) {
          this.socket.emit("participant:buzz", { questionId: s.questionId! });
        }
      });
    }

    if (s.kind === "backFinalist" && !s.backedId && s.finalists.length && !this.handled.has("back")) {
      this.handled.add("back");
      this.later(rand(500, 5000), () => this.socket.emit("participant:back", { finalistId: pick(s.finalists).id }));
    }

    if (s.kind === "removed") this.stop();
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.socket.disconnect();
  }
}

const bots: Bot[] = [];
console.log(`\n  Sending ${count} bots to room ${room} at ${url}. Ctrl+C to stop.\n`);
let made = 0;
const joiner = setInterval(() => {
  // A few at a time, so the Host's name wall fills up visibly.
  for (let k = 0; k < 3 && made < count; k++) {
    made += 1;
    bots.push(new Bot(`${prefix} ${String(made).padStart(2, "0")}`));
  }
  if (made >= count) clearInterval(joiner);
}, 120);

const status = setInterval(() => {
  const connected = bots.filter((b) => b.socket.connected).length;
  const screens = new Map<string, number>();
  for (const b of bots) {
    const kind = b.view?.screen.kind ?? "joining";
    screens.set(kind, (screens.get(kind) ?? 0) + 1);
  }
  const summary = [...screens].map(([k, n]) => `${k} ${n}`).join(", ");
  console.log(`  ${connected}/${bots.length} connected · ${summary}`);
}, 5000);

process.on("SIGINT", () => {
  clearInterval(joiner);
  clearInterval(status);
  for (const b of bots) b.stop();
  console.log("\n  Bots stopped.\n");
  process.exit(0);
});

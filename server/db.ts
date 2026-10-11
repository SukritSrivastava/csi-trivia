/**
 * Saves results to Postgres (Supabase), using the tables from the backend
 * teammate's archive/ws-backend-v1/db.js: rooms, players, game_history. Only on when
 * DATABASE_URL is set. Columns are only ever ADDED to their schema (name,
 * status, ranks, buzzer points, round), so their queries keep working.
 *
 * The game never waits for the database and never stops because of it:
 * writes run one after another in the background, and a failure is logged
 * (at most once a minute) and skipped. The quiz itself lives in memory
 * (quiz.ts), exactly as before.
 *
 *   rooms         one row per quiz: room_code ("KJSC-2026-10-12T19:05"), step, question
 *   players       one row per participant: score, Round 1 rank, buzzer points, status
 *   game_history  one row per Round 1 answer (removed again if the question is voided/restarted)
 */
import pg from "pg";
import type { AnswerRecord, QuizRecorder, RoomSnapshot } from "./quiz";

/** The bit of pg.Pool this file uses (tests pass an in-memory one). */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<unknown>;
  end?(): Promise<void>;
}

const SCHEMA = [
  // The teammate's tables, exactly as archive/ws-backend-v1/db.js creates them.
  `CREATE TABLE IF NOT EXISTS rooms (
     room_code TEXT PRIMARY KEY,
     game_state TEXT,
     current_question_index INTEGER,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS players (
     id SERIAL PRIMARY KEY,
     room_code TEXT,
     player_id TEXT,
     score INTEGER DEFAULT 0,
     UNIQUE(room_code, player_id),
     FOREIGN KEY(room_code) REFERENCES rooms(room_code) ON DELETE CASCADE
   )`,
  `CREATE TABLE IF NOT EXISTS game_history (
     id SERIAL PRIMARY KEY,
     room_code TEXT,
     question_index INTEGER,
     player_id TEXT,
     selected_option INTEGER,
     is_correct BOOLEAN,
     points_awarded INTEGER,
     answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   )`,
  // Added for Hermes Quiz (additive only).
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS name TEXT`,
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS status TEXT`,
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS round1_rank INTEGER`,
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS buzzer_points INTEGER DEFAULT 0`,
  `ALTER TABLE game_history ADD COLUMN IF NOT EXISTS round INTEGER DEFAULT 1`,
  `ALTER TABLE game_history ADD COLUMN IF NOT EXISTS answer_ms INTEGER`,
];

export class Database {
  private chain: Promise<void> = Promise.resolve();
  private lastErrorLog = 0;
  private ready: Promise<boolean>;

  constructor(
    private readonly db: Queryable,
    private readonly log: (message: string) => void = () => {},
  ) {
    this.ready = this.run("create tables", async () => {
      for (const sql of SCHEMA) await this.db.query(sql);
    }).then(
      () => true,
      () => false,
    );
  }

  /** Connects with DATABASE_URL (Supabase needs SSL). null when it isn't set. */
  static fromEnv(log?: (message: string) => void): Database | null {
    const url = process.env.DATABASE_URL;
    if (!url) return null;
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    const pool = new pg.Pool({
      connectionString: url,
      ssl: local ? false : { rejectUnauthorized: false },
      max: 3,
      connectionTimeoutMillis: 5000,
    });
    // An idle connection dropping must not take the quiz down (archive/ws-backend-v1/db.js exits here).
    pool.on("error", (error) => log?.(`[db] connection error: ${error.message}`));
    return new Database(pool, log);
  }

  /** Waits until every queued write is done (tests, shutdown). */
  async drain() {
    await this.ready;
    await this.chain;
  }

  async close() {
    await this.drain();
    await this.db.end?.();
  }

  /** Recorder + snapshot saver for one quiz room. */
  forRoom(code: string): RoomRecorder {
    const key = `${code}-${new Date().toISOString().slice(0, 16)}`;
    return new RoomRecorder(this, key);
  }

  /** Queues a write after the ones before it; failures are logged, never thrown. */
  enqueue(what: string, write: (db: Queryable) => Promise<unknown>) {
    this.chain = this.chain.then(async () => {
      if (!(await this.ready)) return;
      await this.run(what, () => write(this.db));
    });
  }

  private async run(what: string, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (error) {
      const now = Date.now();
      if (now - this.lastErrorLog > 60_000) {
        this.lastErrorLog = now;
        this.log(`[db] couldn't ${what}: ${error instanceof Error ? error.message : String(error)} (the quiz carries on)`);
      }
      if (what === "create tables") throw error;
    }
  }
}

export class RoomRecorder implements QuizRecorder {
  constructor(
    private readonly database: Database,
    /** room_code in the tables: the 4-letter code plus when it was created, so codes reused on another night don't mix. */
    readonly key: string,
  ) {}

  /** Saves the step and everyone's standing (called at most every couple of seconds). */
  save(snapshot: RoomSnapshot) {
    const key = this.key;
    this.database.enqueue("save the room", async (db) => {
      await db.query(
        `INSERT INTO rooms (room_code, game_state, current_question_index) VALUES ($1, $2, $3)
         ON CONFLICT (room_code) DO UPDATE SET game_state = EXCLUDED.game_state, current_question_index = EXCLUDED.current_question_index`,
        [key, snapshot.phase, snapshot.questionIndex],
      );
      if (!snapshot.players.length) return;
      const values: unknown[] = [];
      const rows = snapshot.players.map((p, i) => {
        values.push(key, p.id, p.score, p.name, p.status, p.round1Rank, p.buzzerPoints);
        const o = i * 7;
        return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, $${o + 7})`;
      });
      await db.query(
        `INSERT INTO players (room_code, player_id, score, name, status, round1_rank, buzzer_points) VALUES ${rows.join(", ")}
         ON CONFLICT (room_code, player_id) DO UPDATE SET score = EXCLUDED.score, name = EXCLUDED.name, status = EXCLUDED.status,
           round1_rank = EXCLUDED.round1_rank, buzzer_points = EXCLUDED.buzzer_points`,
        values,
      );
    });
  }

  round1Scored(questionIndex: number, records: AnswerRecord[]) {
    if (!records.length) return;
    const key = this.key;
    this.database.enqueue("log answers", async (db) => {
      const values: unknown[] = [];
      const rows = records.map((r, i) => {
        values.push(key, questionIndex, r.participantId, r.optionIndex, r.correct, r.points, r.elapsedMs);
        const o = i * 7;
        return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}, 1, $${o + 7})`;
      });
      await db.query(
        `INSERT INTO game_history (room_code, question_index, player_id, selected_option, is_correct, points_awarded, round, answer_ms) VALUES ${rows.join(", ")}`,
        values,
      );
    });
  }

  round1Unscored(questionIndex: number) {
    const key = this.key;
    this.database.enqueue("remove cancelled answers", (db) =>
      db.query(`DELETE FROM game_history WHERE room_code = $1 AND round = 1 AND question_index = $2`, [key, questionIndex]),
    );
  }
}

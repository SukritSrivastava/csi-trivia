"use client";

/**
 * Admin's home screen after the PIN: rooms that are open (run one), and the quiz
 * library (create, edit, duplicate, delete, open a room with one). Design
 * extension in the Admin look: panels, typewriter labels, terminal digits, mint actions.
 */
import { useCallback, useEffect, useState } from "react";
import type { OpenRoomSummary, QuizSummary } from "@/shared/protocol";
import { useAdminStore } from "@/stores/adminStore";
import { ControlButton, Dot, Panel, useConfirm } from "../parts";
import { QuizEditor } from "./QuizEditor";

const PHASE_WORDS: Record<string, string> = {
  lobby: "lobby",
  podium: "finished",
  cut: "end of round 1",
  predictions: "predictions",
};
const phaseWord = (p: string) => PHASE_WORDS[p] ?? (p.startsWith("r1") ? "round 1" : p.startsWith("wc") ? "wild card round" : "Blackout");

export function AdminHome() {
  const [editing, setEditing] = useState<string | null>(null);
  if (editing) return <QuizEditor id={editing} onClose={() => setEditing(null)} />;
  return <Home onEdit={setEditing} />;
}

function Home({ onEdit }: { onEdit: (id: string) => void }) {
  const status = useAdminStore((s) => s.status);
  const error = useAdminStore((s) => s.error);
  const signOut = useAdminStore((s) => s.signOut);
  const listRooms = useAdminStore((s) => s.listRooms);
  const listQuizzes = useAdminStore((s) => s.listQuizzes);
  const createQuiz = useAdminStore((s) => s.createQuiz);
  const [rooms, setRooms] = useState<OpenRoomSummary[]>([]);
  const [quizzes, setQuizzes] = useState<QuizSummary[] | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    const [r, q] = await Promise.all([listRooms(), listQuizzes()]);
    if (r) setRooms(r);
    if (q) setQuizzes(q);
  }, [listRooms, listQuizzes]);

  useEffect(() => {
    if (status !== "online") return;
    void refresh();
    const t = window.setInterval(() => void listRooms().then((r) => r && setRooms(r)), 5000);
    return () => window.clearInterval(t);
  }, [status, refresh, listRooms]);

  const newQuiz = async () => {
    setCreating(true);
    const r = await createQuiz("New quiz");
    setCreating(false);
    if (r.ok) onEdit(r.quiz.id);
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-4 px-4 pt-4 pb-10">
      <header className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-term text-2xl leading-none text-mint">hermes://admin</p>
          <p className="mt-1 flex items-center gap-2 text-[14px] text-fog">
            <Dot on={status === "online"} /> {status === "online" ? "Live" : "Reconnecting…"}
          </p>
        </div>
        <button type="button" onClick={signOut} className="min-h-11 rounded-[0.9rem] px-3 text-[15px] text-fog underline underline-offset-4" data-testid="home-signout">
          Sign out
        </button>
      </header>

      {error && (
        <p className="rounded-[0.9rem] border-2 border-wrong bg-wrong/10 px-4 py-3 text-[15px] text-wrong" role="alert">
          {error}
        </p>
      )}

      {rooms.length > 0 && (
        <Panel title="Open rooms" testId="open-rooms">
          <ul className="flex flex-col divide-y divide-line">
            {rooms.map((r) => (
              <RoomRow key={r.roomCode} room={r} onClosed={() => setRooms((all) => all.filter((x) => x.roomCode !== r.roomCode))} />
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title="Quizzes"
        testId="quiz-list"
        aside={
          <button type="button" onClick={newQuiz} disabled={creating} className="phone-go min-h-11 px-4 text-[1.5rem]" data-testid="new-quiz">
            + NEW QUIZ
          </button>
        }
      >
        {quizzes === null ? (
          <p className="py-4 text-[15px] text-fog">Loading…</p>
        ) : quizzes.length === 0 ? (
          <p className="py-4 text-[15px] text-fog">No quizzes yet. Make one with + New quiz.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {quizzes.map((q) => (
              <QuizCard key={q.id} quiz={q} onEdit={() => onEdit(q.id)} onChanged={refresh} />
            ))}
          </ul>
        )}
      </Panel>

      <p className="text-center text-[14px] text-fog">
        The projector: open <span className="text-mint-soft">/host</span> on the laptop and enter the same PIN. It shows the newest open room.
      </p>
    </div>
  );
}

function RoomRow({ room, onClosed }: { room: OpenRoomSummary; onClosed: () => void }) {
  const joinRoom = useAdminStore((s) => s.joinRoom);
  const closeRoom = useAdminStore((s) => s.closeRoom);
  const { armed, guard } = useConfirm();
  const [busy, setBusy] = useState(false);
  return (
    <li className="py-3" data-testid="room-row">
      <div className="flex items-center gap-3">
        <span className="font-term text-3xl leading-none tracking-[0.15em] text-mint">{room.roomCode}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] text-ghost">{room.quizTitle}</p>
          <p className="text-[14px] text-fog">
            {phaseWord(room.phase)} · <span className="font-term text-lg leading-none text-amber">{room.joined}</span> joined
          </p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-[2fr_1fr] gap-2">
        <ControlButton
          onClick={async () => {
            setBusy(true);
            await joinRoom(room.roomCode);
            setBusy(false);
          }}
          disabled={busy}
          testId="run-room"
        >
          Run this room
        </ControlButton>
        <ControlButton
          tone="danger"
          armed={armed === "close"}
          onClick={() =>
            guard("close", async () => {
              if (await closeRoom(room.roomCode)) onClosed();
            })
          }
          testId="close-room"
        >
          {armed === "close" ? "Tap again" : "Close"}
        </ControlButton>
      </div>
    </li>
  );
}

function QuizCard({ quiz, onEdit, onChanged }: { quiz: QuizSummary; onEdit: () => void; onChanged: () => void }) {
  const openRoom = useAdminStore((s) => s.openRoom);
  const duplicateQuiz = useAdminStore((s) => s.duplicateQuiz);
  const deleteQuiz = useAdminStore((s) => s.deleteQuiz);
  const { armed, guard } = useConfirm();
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[] | null>(null);
  const ready = quiz.problems.length === 0;

  const open = async () => {
    setBusy(true);
    const r = await openRoom(quiz.id);
    setBusy(false);
    if (!r.ok) setProblems(r.problems ?? [r.error === "not-found" ? "That quiz no longer exists." : "Couldn't open a room. Try again."]);
    // On success the room's view arrives and Admin switches to it.
  };

  return (
    <li className="rounded-[0.9rem] border border-line bg-void/40 p-3" data-testid="quiz-card">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[18px] leading-snug text-bright">{quiz.title || "Untitled quiz"}</p>
          <p className="mt-0.5 text-[14px] text-mint-soft">
            <span className="font-term text-lg leading-none text-amber">{quiz.round1}</span> round 1 ·{" "}
            <span className="font-term text-lg leading-none text-amber">{quiz.wildcard}</span> wild card ·{" "}
            <span className="font-term text-lg leading-none text-amber">{quiz.blackout}</span> Blackout
          </p>
          <p className={`mt-0.5 text-[14px] ${ready ? "text-mint" : "text-wrong"}`}>
            {ready ? "Ready to play" : `${quiz.problems.length} thing${quiz.problems.length === 1 ? "" : "s"} to fix: ${quiz.problems[0]}`}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[2fr_1fr] gap-2">
        <button type="button" onClick={open} disabled={!ready || busy} className="phone-go min-h-14 text-[1.7rem]" data-testid="open-room">
          {busy ? "…" : "OPEN ROOM"}
        </button>
        <ControlButton onClick={onEdit} testId="edit-quiz">
          Edit
        </ControlButton>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <ControlButton
          onClick={async () => {
            await duplicateQuiz(quiz.id);
            onChanged();
          }}
          testId="duplicate-quiz"
        >
          Duplicate
        </ControlButton>
        <ControlButton
          tone="danger"
          armed={armed === "del"}
          onClick={() =>
            guard("del", async () => {
              await deleteQuiz(quiz.id);
              onChanged();
            })
          }
          testId="delete-quiz"
        >
          {armed === "del" ? "Tap again to delete" : "Delete"}
        </ControlButton>
      </div>
      {problems && (
        <ul className="mt-3 list-disc pl-5 text-[14px] text-wrong" role="alert">
          {problems.slice(0, 6).map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

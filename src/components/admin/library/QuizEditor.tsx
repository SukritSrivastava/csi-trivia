"use client";

/**
 * Edits one quiz: title, the Round 1 list, the buzzer list, and its settings.
 * Saves by itself 1.5 s after the last change (and when you go back). A room
 * that's already open keeps its own frozen copy, so editing never changes a game
 * in progress. Design extension in the Admin look.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { assetUrl } from "@/lib/socket";
import type { LibraryQuestion, Quiz } from "@/shared/protocol";
import { QUIZ_LIMITS } from "@/shared/protocol";
import { type ListName, quizProblems } from "@/shared/quiz";
import { useAdminStore } from "@/stores/adminStore";
import { ControlButton, Panel, useConfirm } from "../parts";
import { ImportPanel } from "./ImportPanel";
import { QuestionForm } from "./QuestionForm";
import { RulesForm } from "./RulesForm";

type Tab = ListName | "settings";
type Sub = { kind: "list" } | { kind: "question"; list: ListName; index: number | null } | { kind: "import"; list: ListName };

const SAVE_AFTER_MS = 1500;
const LIST_LABEL: Record<ListName, string> = { round1: "Round 1", buzzer: "Buzzer round" };

export function QuizEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const getQuiz = useAdminStore((s) => s.getQuiz);
  const saveQuiz = useAdminStore((s) => s.saveQuiz);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "unsaved" | "saving" | "failed">("saved");
  const [tab, setTab] = useState<Tab>("round1");
  const [sub, setSub] = useState<Sub>({ kind: "list" });
  const latest = useRef<Quiz | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    void getQuiz(id).then((q) => (q ? setQuiz(q) : setLoadError("Couldn't load this quiz. Go back and try again.")));
  }, [getQuiz, id]);

  const saveNow = useCallback(async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const q = latest.current;
    if (!q) return true;
    setSaveState("saving");
    const r = await saveQuiz(q);
    // Only mark saved if nothing changed while saving.
    if (latest.current === q) setSaveState(r.ok ? "saved" : "failed");
    return r.ok;
  }, [saveQuiz]);

  /** Every edit goes through here: update, then save a moment later. */
  const update = useCallback(
    (change: (q: Quiz) => Quiz) => {
      setQuiz((prev) => {
        if (!prev) return prev;
        const next = change(prev);
        latest.current = next;
        return next;
      });
      setSaveState("unsaved");
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void saveNow(), SAVE_AFTER_MS);
    },
    [saveNow],
  );

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const back = async () => {
    if (saveState !== "saved") await saveNow();
    onClose();
  };

  if (!quiz) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-4 px-4 pt-4">
        <button type="button" onClick={onClose} className="self-start text-[15px] text-mint-soft underline underline-offset-4">
          ← Quizzes
        </button>
        <p className={`text-[15px] ${loadError ? "text-wrong" : "text-fog"}`}>{loadError ?? "Loading…"}</p>
      </div>
    );
  }

  const problems = quizProblems(quiz);

  if (sub.kind === "question") {
    const list = quiz[sub.list];
    return (
      <QuestionForm
        listLabel={LIST_LABEL[sub.list]}
        number={sub.index === null ? list.length + 1 : sub.index + 1}
        isBuzzer={sub.list === "buzzer"}
        rules={quiz.rules}
        initial={sub.index === null ? null : list[sub.index]}
        onCancel={() => setSub({ kind: "list" })}
        onSave={(q) => {
          update((prev) => {
            const items = [...prev[sub.list]];
            if (sub.index === null) items.push(q);
            else items[sub.index] = q;
            return { ...prev, [sub.list]: items };
          });
          setSub({ kind: "list" });
        }}
        onDelete={
          sub.index === null
            ? undefined
            : () => {
                update((prev) => ({ ...prev, [sub.list]: prev[sub.list].filter((_, i) => i !== sub.index) }));
                setSub({ kind: "list" });
              }
        }
      />
    );
  }

  if (sub.kind === "import") {
    return (
      <ImportPanel
        target={sub.list}
        onCancel={() => setSub({ kind: "list" })}
        onAdd={(found) => {
          update((prev) => ({
            ...prev,
            round1: [...prev.round1, ...found.round1].slice(0, QUIZ_LIMITS.questionsPerList),
            buzzer: [...prev.buzzer, ...found.buzzer].slice(0, QUIZ_LIMITS.questionsPerList),
          }));
          setSub({ kind: "list" });
        }}
      />
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-void/95 px-4 pt-3 pb-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <button type="button" onClick={back} className="min-h-11 shrink-0 text-[15px] text-mint-soft underline underline-offset-4" data-testid="editor-back">
            ← Quizzes
          </button>
          <SaveBadge state={saveState} onRetry={() => void saveNow()} />
        </div>
        <input
          value={quiz.title}
          onChange={(e) => update((q) => ({ ...q, title: e.target.value.slice(0, QUIZ_LIMITS.title) }))}
          placeholder="Quiz title"
          aria-label="Quiz title"
          className="mx-auto mt-2 block w-full max-w-3xl rounded-[0.9rem] border-2 border-line bg-void px-4 py-2.5 text-[20px] text-bright outline-none focus:border-mint"
          data-testid="quiz-title"
        />
      </header>

      <nav className="border-b border-line bg-void" role="tablist">
        <div className="mx-auto flex max-w-3xl">
          {(
            [
              ["round1", "Round 1", quiz.round1.length],
              ["buzzer", "Buzzer", quiz.buzzer.length],
              ["settings", "Settings", null],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className="flex min-h-12 flex-1 items-center justify-center gap-1.5 border-b-2 border-transparent text-[16px] text-fog aria-selected:border-mint aria-selected:text-ghost"
              data-testid={`editor-tab-${key}`}
            >
              {label}
              {count !== null && <span className="font-term text-xl leading-none text-amber">{count}</span>}
              {key === "settings" && problems.length > 0 && <span className="size-2 rounded-full bg-wrong" aria-label={`${problems.length} things to fix`} />}
            </button>
          ))}
        </div>
      </nav>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {tab === "settings" ? (
            <>
              <ReadyPanel problems={problems} />
              <RulesForm quiz={quiz} onChange={(rules) => update((q) => ({ ...q, rules }))} />
            </>
          ) : (
            <QuestionList
              list={tab}
              quiz={quiz}
              onAdd={() => setSub({ kind: "question", list: tab, index: null })}
              onImport={() => setSub({ kind: "import", list: tab })}
              onEdit={(index) => setSub({ kind: "question", list: tab, index })}
              onMove={(index, by) =>
                update((q) => {
                  const items = [...q[tab]];
                  const to = index + by;
                  if (to < 0 || to >= items.length) return q;
                  [items[index], items[to]] = [items[to], items[index]];
                  return { ...q, [tab]: items };
                })
              }
              onDelete={(index) => update((q) => ({ ...q, [tab]: q[tab].filter((_, i) => i !== index) }))}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function SaveBadge({ state, onRetry }: { state: "saved" | "unsaved" | "saving" | "failed"; onRetry: () => void }) {
  if (state === "failed") {
    return (
      <button type="button" onClick={onRetry} className="ml-auto text-[14px] text-wrong underline underline-offset-4" role="alert">
        Not saved. Tap to retry
      </button>
    );
  }
  return (
    <span className={`ml-auto text-[14px] ${state === "saved" ? "text-mint" : "text-fog"}`} role="status" data-testid="save-state">
      {state === "saved" ? "Saved" : state === "saving" ? "Saving…" : "Unsaved changes"}
    </span>
  );
}

function ReadyPanel({ problems }: { problems: string[] }) {
  return (
    <Panel title="Ready to play?" testId="ready">
      {problems.length === 0 ? (
        <p className="text-[16px] text-mint">Yes. Go back to Quizzes and tap Open room.</p>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[15px] text-wrong">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function QuestionList({
  list,
  quiz,
  onAdd,
  onImport,
  onEdit,
  onMove,
  onDelete,
}: {
  list: ListName;
  quiz: Quiz;
  onAdd: () => void;
  onImport: () => void;
  onEdit: (index: number) => void;
  onMove: (index: number, by: -1 | 1) => void;
  onDelete: (index: number) => void;
}) {
  const items = quiz[list];
  const played = list === "round1" ? quiz.rules.round1Questions : quiz.rules.buzzerQuestions;
  const { armed, guard } = useConfirm();

  return (
    <>
      <div className="grid grid-cols-[3fr_2fr] gap-2">
        <button type="button" onClick={onAdd} className="phone-go min-h-14 text-[1.5rem] whitespace-nowrap" data-testid="add-question">
          + ADD QUESTION
        </button>
        <ControlButton onClick={onImport} testId="import-questions">
          Import many
        </ControlButton>
      </div>
      <p className="text-[14px] text-fog">
        {list === "round1"
          ? `Everyone answers these, top to bottom. The first ${played} are played (change it in Settings).`
          : `The finalists buzz on these, top to bottom. The first ${played} count; the rest are spares for voided questions and sudden death.`}
      </p>

      {items.length === 0 ? (
        <p className="rounded-[0.9rem] border-2 border-dashed border-line px-4 py-8 text-center text-[15px] text-fog">
          No questions yet. Add one, or import a list.
        </p>
      ) : (
        <ol className="flex flex-col gap-2" data-testid="question-list">
          {items.map((q, i) => (
            <li key={q.id}>
              {i === played && (
                <p className="my-2 flex items-center gap-2 text-[14px] text-fog" aria-hidden>
                  <span className="h-px flex-1 bg-line" /> spares below <span className="h-px flex-1 bg-line" />
                </p>
              )}
              <QuestionCard
                q={q}
                number={i + 1}
                spare={i >= played}
                onEdit={() => onEdit(i)}
                onUp={i > 0 ? () => onMove(i, -1) : undefined}
                onDown={i < items.length - 1 ? () => onMove(i, 1) : undefined}
                deleteArmed={armed === q.id}
                onDelete={() => guard(q.id, () => onDelete(i))}
              />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function QuestionCard({
  q,
  number,
  spare,
  onEdit,
  onUp,
  onDown,
  deleteArmed,
  onDelete,
}: {
  q: LibraryQuestion;
  number: number;
  spare: boolean;
  onEdit: () => void;
  onUp?: () => void;
  onDown?: () => void;
  deleteArmed: boolean;
  onDelete: () => void;
}) {
  const small = "flex size-11 shrink-0 items-center justify-center rounded-[0.7rem] border-2 border-line text-mint-soft disabled:opacity-30";
  return (
    <div className={`rounded-[0.9rem] border border-line bg-panel p-3 ${spare ? "opacity-70" : ""}`} data-testid="question-card">
      <button type="button" onClick={onEdit} className="flex w-full items-start gap-3 text-left">
        <span className="w-8 shrink-0 font-term text-[2rem] leading-none text-amber">{number}</span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[16px] leading-snug text-bright">{q.text || <span className="text-wrong">Empty question</span>}</span>
          <span className="mt-1 block truncate text-[14px] text-mint">✓ {q.options[q.correct] || "—"}</span>
          <span className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-fog">
            {spare && <span>spare</span>}
            {q.image && <span>picture</span>}
            {(q.readSeconds !== null || q.openSeconds !== null) && (
              <span>
                own timer{q.readSeconds !== null ? ` · read ${q.readSeconds}s` : ""}
                {q.openSeconds !== null ? ` · ${q.openSeconds}s` : ""}
              </span>
            )}
          </span>
        </span>
        {q.image && <img src={assetUrl(q.image)} alt="" className="size-14 shrink-0 rounded-[0.6rem] border border-line object-cover" />}
      </button>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={onUp} disabled={!onUp} className={small} aria-label={`Move question ${number} up`}>
          <span className="font-term text-2xl leading-none">↑</span>
        </button>
        <button type="button" onClick={onDown} disabled={!onDown} className={small} aria-label={`Move question ${number} down`}>
          <span className="font-term text-2xl leading-none">↓</span>
        </button>
        <button type="button" onClick={onEdit} className={`${small} w-auto px-3 text-[14px]`}>
          Edit
        </button>
        <button
          type="button"
          onClick={onDelete}
          className={`ml-auto min-h-11 rounded-[0.7rem] border-2 border-wrong px-3 text-[14px] ${deleteArmed ? "bg-wrong text-void" : "text-wrong"}`}
          data-testid="delete-question"
        >
          {deleteArmed ? "Tap again" : "Delete"}
        </button>
      </div>
    </div>
  );
}

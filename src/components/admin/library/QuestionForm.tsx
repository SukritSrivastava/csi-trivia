"use client";

/**
 * Add or edit one question: the question, 4 answers (tap the number of the right
 * one; in Round 1 the numbers are checkboxes, so 2+ ticked makes it multi-correct),
 * an optional picture (projector only), and optional own timers.
 * Design extension in the Admin look: answer rows like phone-opt with the
 * number in amber terminal digits, the right one lit in mint.
 */
import { useRef, useState } from "react";
import { shrinkImage } from "@/lib/image";
import { assetUrl } from "@/lib/socket";
import { type LibraryQuestion, MULTI_ANSWER_SECONDS, QUIZ_LIMITS, type QuizRules } from "@/shared/protocol";
import { blankQuestion, correctList, type ListName, packCorrect, questionProblems } from "@/shared/quiz";
import { useAdminStore } from "@/stores/adminStore";
import { ControlButton, Panel, useConfirm } from "../parts";

const field = "w-full rounded-[0.9rem] border-2 border-line bg-void px-3 py-2.5 text-[16px] text-ghost outline-none focus:border-mint";

export function QuestionForm({
  listLabel,
  number,
  list,
  rules,
  initial,
  onSave,
  onCancel,
  onDelete,
}: {
  listLabel: string;
  number: number;
  list: ListName;
  rules: QuizRules;
  initial: LibraryQuestion | null;
  onSave: (q: LibraryQuestion) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const uploadImage = useAdminStore((s) => s.uploadImage);
  // A new question starts with nothing ticked (with checkboxes, a pre-ticked 1 would quietly make it multi-correct).
  const [q, setQ] = useState<LibraryQuestion>(() => initial ?? { ...blankQuestion(), correct: [] });
  const [touched, setTouched] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { armed, guard } = useConfirm();
  const problems = questionProblems(q, "This question", list).map((p) => p.replace(/^This question: /, ""));
  // Several right answers are allowed in Round 1 only; elsewhere the numbers work like radio buttons.
  const multiAllowed = list === "round1";
  const right = correctList(q.correct);
  const multi = right.length >= 2;
  const toggleRight = (i: number) =>
    setQ((prev) => {
      const now = correctList(prev.correct);
      if (!multiAllowed) return { ...prev, correct: i };
      // At least one stays ticked: tapping the only right answer does nothing.
      const next = now.includes(i) ? (now.length > 1 ? now.filter((x) => x !== i) : now) : [...now, i];
      return { ...prev, correct: packCorrect(next) };
    });
  // The wild card round uses Round 1's timings; a multi-correct question gets 15 s by default.
  const defaults =
    list === "blackout"
      ? { read: rules.blackoutReadSeconds, open: rules.blackoutAnswerSeconds, openLabel: "Answer time" }
      : { read: rules.round1ReadSeconds, open: multi ? (rules.multiAnswerSeconds ?? MULTI_ANSWER_SECONDS) : rules.round1AnswerSeconds, openLabel: "Answer time" };

  const setOption = (i: number, text: string) =>
    setQ((prev) => {
      const options = [...prev.options] as LibraryQuestion["options"];
      options[i] = text.slice(0, QUIZ_LIMITS.optionText);
      return { ...prev, options };
    });

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    setImageError(null);
    setUploading(true);
    try {
      const url = await uploadImage(await shrinkImage(file));
      setQ((prev) => ({ ...prev, image: url }));
    } catch (e) {
      setImageError(e instanceof Error ? e.message : "The upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const seconds = (v: string) => (v.trim() === "" ? null : Math.round(Number(v)));

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-4 pt-4 pb-28">
      <header className="flex items-center gap-3">
        <button type="button" onClick={onCancel} className="min-h-11 text-[15px] text-mint-soft underline underline-offset-4">
          ← Back
        </button>
        <p className="ml-auto text-[14px] text-fog">
          {listLabel}, question <span className="font-term text-xl leading-none text-amber">{number}</span>
        </p>
      </header>

      <label className="flex flex-col gap-1.5 text-[15px] text-mint-soft">
        Question
        <textarea
          value={q.text}
          onChange={(e) => setQ({ ...q, text: e.target.value.slice(0, QUIZ_LIMITS.questionText) })}
          rows={3}
          autoFocus={!initial}
          className={`${field} resize-y text-[18px] leading-snug text-bright`}
          placeholder="What does LLM stand for?"
          data-testid="q-text"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-mint-soft">
          <span>{multiAllowed ? "Answers: tick every right one (tap its number)" : "Answers: tap the number of the right one"}</span>
          <span
            className={`ml-auto rounded-[0.6rem] border-2 px-2 py-0.5 text-[14px] ${multi ? "border-amber text-amber" : "border-line text-fog"}`}
            data-testid="q-kind"
          >
            {multi ? (
              <>
                Multi-correct: <span className="font-term text-lg leading-none">{right.length}</span> right
              </>
            ) : (
              "Single answer"
            )}
          </span>
        </legend>
        {!multiAllowed && <p className="-mt-1 text-[14px] text-fog">Only Round 1 questions can have more than one right answer.</p>}
        {q.options.map((o, i) => {
          const isRight = right.includes(i);
          return (
            <div key={i} className={`flex items-center gap-2 rounded-[0.9rem] border-2 p-1.5 ${isRight ? "border-mint bg-mint/[0.1]" : "border-line"}`}>
              <button
                type="button"
                onClick={() => toggleRight(i)}
                role={multiAllowed ? "checkbox" : "radio"}
                aria-checked={isRight}
                aria-label={`Answer ${i + 1} is ${multiAllowed ? "a" : "the"} right one`}
                className={`flex size-12 shrink-0 items-center justify-center rounded-[0.7rem] border-2 font-term text-[2rem] leading-none ${
                  isRight ? "border-mint bg-mint text-void" : multiAllowed ? "border-mint/50 text-amber" : "border-transparent text-amber"
                }`}
                data-testid={`q-correct-${i}`}
              >
                {i + 1}
              </button>
              <input
                value={o}
                onChange={(e) => setOption(i, e.target.value)}
                placeholder={`Answer ${i + 1}`}
                aria-label={`Answer ${i + 1}`}
                className="min-w-0 flex-1 bg-transparent px-1 py-2 text-[16px] text-ghost outline-none placeholder:text-fog"
                data-testid={`q-option-${i}`}
              />
              {isRight && <span className="shrink-0 pr-2 font-term text-lg leading-none text-mint">✓ RIGHT</span>}
            </div>
          );
        })}
        <p className="text-[14px] text-fog">
          The 4 answers are shuffled on screen, so put them in any order.
          {multiAllowed &&
            ` Tick 2 or more for a multi-correct question: players tick all that apply, then lock in (${rules.multiAnswerSeconds ?? MULTI_ANSWER_SECONDS} s unless it has its own time). They're never told how many are right.`}
        </p>
      </fieldset>

      <Panel title="Picture (projector only, optional)">
        {q.image ? (
          <div className="flex items-center gap-3">
            <img src={assetUrl(q.image)} alt="" className="h-28 w-40 rounded-[0.7rem] border border-line bg-void object-contain" />
            <div className="flex flex-col gap-2">
              <ControlButton onClick={() => fileInput.current?.click()} disabled={uploading}>
                Replace
              </ControlButton>
              <ControlButton tone="danger" onClick={() => setQ({ ...q, image: null })}>
                Remove
              </ControlButton>
            </div>
          </div>
        ) : (
          <ControlButton onClick={() => fileInput.current?.click()} disabled={uploading} className="w-full" testId="q-image">
            {uploading ? "Uploading…" : "+ Add a picture"}
          </ControlButton>
        )}
        <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => void pickImage(e.target.files?.[0])} />
        {imageError && (
          <p className="mt-2 text-[14px] text-wrong" role="alert">
            {imageError}
          </p>
        )}
      </Panel>

      <Panel title="Own timer (optional)">
        <p className="mb-2 text-[14px] text-fog">Leave empty to use the quiz&apos;s times (shown in grey).</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-[14px] text-mint-soft">
            Read time (s)
            <input
              type="number"
              inputMode="numeric"
              min={QUIZ_LIMITS.readSeconds.min}
              max={QUIZ_LIMITS.readSeconds.max}
              value={q.readSeconds ?? ""}
              placeholder={String(defaults.read)}
              onChange={(e) => setQ({ ...q, readSeconds: seconds(e.target.value) })}
              className={`${field} font-term text-2xl leading-none`}
            />
          </label>
          <label className="flex flex-col gap-1 text-[14px] text-mint-soft">
            {defaults.openLabel} (s)
            <input
              type="number"
              inputMode="numeric"
              min={QUIZ_LIMITS.openSeconds.min}
              max={QUIZ_LIMITS.openSeconds.max}
              value={q.openSeconds ?? ""}
              placeholder={String(defaults.open)}
              onChange={(e) => setQ({ ...q, openSeconds: seconds(e.target.value) })}
              className={`${field} font-term text-2xl leading-none`}
            />
          </label>
        </div>
      </Panel>

      {touched && problems.length > 0 && (
        <ul className="list-disc pl-5 text-[15px] text-wrong" role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-void px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto grid max-w-2xl grid-cols-[2fr_1fr] gap-2">
          <button
            type="button"
            className="phone-go min-h-14 text-[1.8rem]"
            onClick={() => {
              setTouched(true);
              if (problems.length === 0) onSave({ ...q, text: q.text.trim(), options: q.options.map((o) => o.trim()) as LibraryQuestion["options"] });
            }}
            disabled={uploading}
            data-testid="q-save"
          >
            SAVE QUESTION
          </button>
          {onDelete ? (
            <ControlButton tone="danger" armed={armed === "del"} onClick={() => guard("del", onDelete)}>
              {armed === "del" ? "Tap again" : "Delete"}
            </ControlButton>
          ) : (
            <ControlButton onClick={onCancel}>Cancel</ControlButton>
          )}
        </div>
      </div>
    </div>
  );
}

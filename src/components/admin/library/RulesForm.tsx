"use client";

/**
 * A quiz's settings: how many questions each round plays, the finalists, and
 * every timer. Plus downloads (the quiz as CSV / JSON, and the blank template).
 * Design extension in the Admin look: terminal-digit steppers on panels.
 */
import { downloadText } from "@/lib/image";
import { type Quiz, QUIZ_LIMITS, type QuizRules } from "@/shared/protocol";
import { quizToCsv, TEMPLATE_CSV } from "@/shared/quiz";
import { ControlButton, Panel } from "../parts";

type Key = keyof QuizRules;

function Stepper({
  label,
  hint,
  value,
  min,
  max,
  unit,
  onChange,
  testId,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  onChange: (v: number) => void;
  testId?: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)));
  const btn = "flex size-12 shrink-0 items-center justify-center rounded-[0.8rem] border-2 border-mint bg-mint/[0.07] font-term text-3xl leading-none text-ghost active:bg-mint/20 disabled:border-line disabled:text-fog";
  return (
    // Phone: the words take the full width, the stepper sits under them on the right. Wider: one row.
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
        <p className="text-[16px] leading-snug text-ghost">{label}</p>
        {hint && <p className="text-[13px] leading-snug text-fog">{hint}</p>}
      </div>
      <button type="button" className={`${btn} ml-auto sm:ml-0`} onClick={() => onChange(clamp(value - 1))} disabled={value <= min} aria-label={`${label}: less`}>
        −
      </button>
      <label className="flex w-20 shrink-0 flex-col items-center">
        <input
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          onChange={(e) => e.target.value !== "" && onChange(clamp(Number(e.target.value)))}
          aria-label={label}
          className="w-full bg-transparent text-center font-term text-[2.2rem] leading-none text-amber outline-none"
          data-testid={testId}
        />
        {unit && <span className="text-[12px] text-fog">{unit}</span>}
      </label>
      <button type="button" className={btn} onClick={() => onChange(clamp(value + 1))} disabled={value >= max} aria-label={`${label}: more`}>
        +
      </button>
    </div>
  );
}

export function RulesForm({ quiz, onChange }: { quiz: Quiz; onChange: (rules: QuizRules) => void }) {
  const r = quiz.rules;
  const set = (key: Key) => (v: number) => onChange({ ...r, [key]: v });
  const read = QUIZ_LIMITS.readSeconds;
  const open = QUIZ_LIMITS.openSeconds;
  const fileName = (quiz.title.trim() || "quiz").replace(/[^\w-]+/g, "-").toLowerCase();

  return (
    <>
      <Panel title="Round 1 (everyone)">
        <div className="divide-y divide-line">
          <Stepper
            label="Questions to play"
            hint={`Of the ${quiz.round1.length} in the Round 1 list; the rest are spares.`}
            value={r.round1Questions}
            min={1}
            max={Math.max(1, quiz.round1.length)}
            onChange={set("round1Questions")}
            testId="rule-round1Questions"
          />
          <Stepper label="Time to read" hint="Question on the projector, answers not yet on phones." value={r.round1ReadSeconds} min={read.min} max={read.max} unit="seconds" onChange={set("round1ReadSeconds")} />
          <Stepper label="Time to answer" hint="Faster right answers score more (500–1000)." value={r.round1AnswerSeconds} min={open.min} max={open.max} unit="seconds" onChange={set("round1AnswerSeconds")} />
        </div>
      </Panel>

      <Panel title="The cut">
        <Stepper
          label="Finalists"
          hint="The top players after Round 1 who play the buzzer round. Everyone else backs one of them."
          value={r.finalists}
          min={QUIZ_LIMITS.finalists.min}
          max={QUIZ_LIMITS.finalists.max}
          onChange={set("finalists")}
          testId="rule-finalists"
        />
      </Panel>

      <Panel title="Buzzer round (finalists)">
        <div className="divide-y divide-line">
          <Stepper
            label="Questions that count"
            hint={`Of the ${quiz.buzzer.length} in the buzzer list; the rest are spares for voids and sudden death.`}
            value={r.buzzerQuestions}
            min={1}
            max={Math.max(1, quiz.buzzer.length)}
            onChange={set("buzzerQuestions")}
            testId="rule-buzzerQuestions"
          />
          <Stepper label="Time to read" hint="Buzzers locked while the room reads." value={r.buzzerReadSeconds} min={read.min} max={read.max} unit="seconds" onChange={set("buzzerReadSeconds")} />
          <Stepper label="Buzz window" hint="How long buzzers stay open." value={r.buzzWindowSeconds} min={open.min} max={open.max} unit="seconds" onChange={set("buzzWindowSeconds")} />
          <Stepper label="Time to say the answer" hint="Countdown after a buzz. It never marks the answer; you do." value={r.spokenAnswerSeconds} min={open.min} max={open.max} unit="seconds" onChange={set("spokenAnswerSeconds")} />
          <Stepper label="Reopen window" hint="Buzzers for the others after a wrong answer." value={r.reopenSeconds} min={open.min} max={open.max} unit="seconds" onChange={set("reopenSeconds")} />
        </div>
      </Panel>

      <Panel title="Download">
        <div className="grid grid-cols-2 gap-2">
          <ControlButton onClick={() => downloadText(`${fileName}.csv`, quizToCsv(quiz), "text/csv")}>Quiz as spreadsheet (CSV)</ControlButton>
          <ControlButton onClick={() => downloadText(`${fileName}.json`, JSON.stringify({ title: quiz.title, rules: quiz.rules, round1: quiz.round1, buzzer: quiz.buzzer }, null, 2), "application/json")}>
            Quiz as JSON
          </ControlButton>
        </div>
        <p className="mt-2 text-[13px] text-fog">A backup, or to edit in Excel / Google Sheets and import again.</p>
      </Panel>

      <p className="pb-6 text-center text-[13px] text-fog">
        Blank spreadsheet to fill in:{" "}
        <button type="button" onClick={() => downloadText("hermes-quiz-template.csv", TEMPLATE_CSV, "text/csv")} className="text-mint-soft underline underline-offset-4">
          download the template
        </button>
      </p>
    </>
  );
}

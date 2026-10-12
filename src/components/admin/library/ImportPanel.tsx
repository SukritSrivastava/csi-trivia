"use client";

/**
 * Adds many questions at once: paste text, a spreadsheet (CSV or Excel), or
 * JSON. Shows a preview (and any rows it couldn't read) before adding anything.
 * Design extension in the Admin look.
 */
import { useRef, useState } from "react";
import { downloadText } from "@/lib/image";
import { importJson, importRows, importText, type ImportResult, type ListName, parseCsv, TEMPLATE_CSV } from "@/shared/quiz";
import { ControlButton, Panel } from "../parts";

type Mode = "text" | "sheet" | "json";

const EXAMPLE = `What does LLM stand for?
* Large Language Model
Linear Logic Machine
Layered Learning Matrix
Long-term Language Memory

In an AI agent, what is a "tool call"?
A) A phone call to support
B) The agent asking a program to do something
C) A bug report
D) A software licence
Answer: B

# Buzzer
Which company makes Claude?
* Anthropic
OpenAI
Google
Meta`;

export function ImportPanel({ target, onAdd, onCancel }: { target: ListName; onAdd: (found: ImportResult) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<Mode>("text");
  const [into, setInto] = useState<ListName>(target);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const readText = (value: string) => {
    setInput(value);
    setResult(value.trim() ? (mode === "json" ? importJson(value, into) : importText(value, into)) : null);
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setFileName(file.name);
    try {
      if (/\.json$/i.test(file.name)) {
        setResult(importJson(await file.text(), into));
      } else if (/\.(xlsx|xlsm)$/i.test(file.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        const rows = await readSheet(file);
        setResult(importRows(rows as unknown[][], into));
      } else {
        setResult(importRows(parseCsv(await file.text()), into));
      }
    } catch (e) {
      setResult({ round1: [], buzzer: [], problems: [`Couldn't read ${file.name}: ${e instanceof Error ? e.message : "unknown error"}. Old .xls files: save as .xlsx or CSV first.`] });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setInput("");
    setResult(null);
    setFileName(null);
  };

  const count = result ? result.round1.length + result.buzzer.length : 0;
  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => switchMode(m)}
      className="flex min-h-11 flex-1 items-center justify-center rounded-[0.8rem] border-2 border-line text-[15px] text-mint-soft aria-selected:border-mint aria-selected:bg-mint/[0.1] aria-selected:text-ghost"
      data-testid={`import-mode-${m}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-4 pt-4 pb-28">
      <header className="flex items-center gap-3">
        <button type="button" onClick={onCancel} className="min-h-11 text-[15px] text-mint-soft underline underline-offset-4">
          ← Back
        </button>
        <p className="ml-auto text-[16px] text-bright">Import questions</p>
      </header>

      <div className="flex gap-2" role="tablist">
        {tab("text", "Paste text")}
        {tab("sheet", "Spreadsheet")}
        {tab("json", "JSON")}
      </div>

      <label className="flex items-center gap-3 text-[15px] text-mint-soft">
        Questions with no round go to
        <select
          value={into}
          onChange={(e) => {
            const v = e.target.value as ListName;
            setInto(v);
            if (input.trim()) setResult(mode === "json" ? importJson(input, v) : importText(input, v));
          }}
          className="min-h-11 rounded-[0.8rem] border-2 border-line bg-void px-3 text-[16px] text-ghost outline-none focus:border-mint"
        >
          <option value="round1">Round 1</option>
          <option value="buzzer">Buzzer round</option>
        </select>
      </label>

      {mode === "text" && (
        <Panel title="Paste your questions">
          <p className="mb-2 text-[14px] leading-snug text-fog">
            One question, then its 4 answers, each on its own line. Mark the right answer with <span className="text-mint">*</span> (or add a line{" "}
            <span className="text-mint">Answer: B</span>). Leave a blank line between questions. A line <span className="text-mint"># Buzzer</span> puts the questions after
            it in the buzzer round.
          </p>
          <textarea
            value={input}
            onChange={(e) => readText(e.target.value)}
            rows={12}
            placeholder={EXAMPLE}
            className="w-full resize-y rounded-[0.9rem] border-2 border-line bg-void px-3 py-2.5 font-type text-[16px] leading-snug text-ghost outline-none placeholder:text-fog/60 focus:border-mint"
            data-testid="import-text"
          />
          <button type="button" onClick={() => readText(EXAMPLE)} className="mt-2 text-[14px] text-mint-soft underline underline-offset-4">
            Fill in the example
          </button>
        </Panel>
      )}

      {mode === "sheet" && (
        <Panel title="Upload a spreadsheet">
          <p className="mb-3 text-[14px] leading-snug text-fog">
            Excel (.xlsx) or CSV. First row: <span className="text-mint">question, A, B, C, D, correct</span> and optionally{" "}
            <span className="text-mint">round</span> (1 or buzzer), <span className="text-mint">read seconds</span>,{" "}
            <span className="text-mint">answer seconds</span>. &quot;correct&quot; is A–D (or 1–4). Google Sheets: File → Download → .xlsx or .csv.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <ControlButton onClick={() => fileInput.current?.click()} disabled={busy} testId="import-file">
              {busy ? "Reading…" : fileName ? "Pick another file" : "Choose file"}
            </ControlButton>
            <ControlButton onClick={() => downloadText("hermes-quiz-template.csv", TEMPLATE_CSV, "text/csv")}>Download template</ControlButton>
          </div>
          {fileName && <p className="mt-2 truncate text-[14px] text-mint-soft">{fileName}</p>}
          <input ref={fileInput} type="file" accept=".csv,.xlsx,.xlsm,.txt,text/csv" className="hidden" onChange={(e) => void readFile(e.target.files?.[0])} />
        </Panel>
      )}

      {mode === "json" && (
        <Panel title="JSON">
          <p className="mb-2 text-[14px] leading-snug text-fog">
            A quiz downloaded from here, the repo&apos;s <span className="text-mint">data/questions.json</span>, or a list of{" "}
            <span className="text-mint">{"{ text, options: [4], correct: 0–3, round }"}</span>.
          </p>
          <ControlButton onClick={() => fileInput.current?.click()} disabled={busy} className="mb-2 w-full">
            {fileName ? "Pick another file" : "Choose a .json file"}
          </ControlButton>
          <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={(e) => void readFile(e.target.files?.[0])} />
          <textarea
            value={input}
            onChange={(e) => readText(e.target.value)}
            rows={8}
            placeholder='{ "questions": [ { "text": "…", "options": ["…","…","…","…"], "correct": 0 } ] }'
            className="w-full resize-y rounded-[0.9rem] border-2 border-line bg-void px-3 py-2.5 font-mono text-[14px] text-ghost outline-none placeholder:text-fog/60 focus:border-mint"
          />
        </Panel>
      )}

      {result && (
        <Panel title="Preview" testId="import-preview">
          <p className="text-[16px] text-ghost">
            Found <span className="font-term text-2xl leading-none text-amber">{result.round1.length}</span> for Round 1 and{" "}
            <span className="font-term text-2xl leading-none text-amber">{result.buzzer.length}</span> for the buzzer round.
          </p>
          {result.problems.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-[14px] text-wrong" role="alert">
              {result.problems.slice(0, 12).map((p) => (
                <li key={p}>{p}</li>
              ))}
              {result.problems.length > 12 && <li>…and {result.problems.length - 12} more.</li>}
            </ul>
          )}
          <ol className="mt-3 flex flex-col gap-1.5">
            {[...result.round1.map((q) => ["R1", q] as const), ...result.buzzer.map((q) => ["B", q] as const)].slice(0, 8).map(([tag, q]) => (
              <li key={q.id} className="text-[14px] leading-snug">
                <span className="mr-2 font-term text-lg leading-none text-amber">{tag}</span>
                <span className="text-ghost">{q.text}</span> <span className="text-mint">✓ {q.options[q.correct]}</span>
              </li>
            ))}
            {count > 8 && <li className="text-[14px] text-fog">…and {count - 8} more.</li>}
          </ol>
        </Panel>
      )}

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-void/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
        <div className="mx-auto grid max-w-2xl grid-cols-[2fr_1fr] gap-2">
          <button type="button" className="phone-go min-h-14 text-[1.8rem]" disabled={count === 0} onClick={() => result && onAdd(result)} data-testid="import-add">
            {count ? `ADD ${count} QUESTION${count === 1 ? "" : "S"}` : "NOTHING TO ADD"}
          </button>
          <ControlButton onClick={onCancel}>Cancel</ControlButton>
        </div>
      </div>
    </div>
  );
}

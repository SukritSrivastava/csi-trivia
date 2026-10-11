"use client";

import { useState } from "react";
import { usePlayerStore } from "@/stores/playerStore";
import { ANSWER_MAX_LENGTH, type PlayerScreen, type PlayerView } from "@/shared/protocol";

type Screen = Extract<PlayerScreen, { kind: "answer" }>;

export function AnswerScreen({ screen }: { screen: Screen; view: PlayerView }) {
  const answer = usePlayerStore((s) => s.answer);
  const sent = usePlayerStore((s) => s.sentPromptId === screen.promptId);
  const [text, setText] = useState("");
  const left = ANSWER_MAX_LENGTH - text.length;
  const canSend = text.trim().length > 0 && !sent;

  if (sent) {
    return (
      <div className="flex flex-1 flex-col justify-center text-center">
        <p className="type-wide text-3xl font-black">Sent</p>
      </div>
    );
  }

  return (
    <form
      className="flex flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) answer(screen.promptId, text);
      }}
    >
      {screen.steps > 1 && (
        <p className="text-sm font-bold text-paper/70">
          Prompt {screen.step} of {screen.steps}
        </p>
      )}
      <h1 className="mt-1 text-[1.7rem] font-black leading-snug text-balance">{screen.prompt}</h1>

      <label className="mt-5 flex flex-col gap-2">
        <span className="sr-only">Your answer</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.replace(/\n/g, " ").slice(0, ANSWER_MAX_LENGTH))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (canSend) answer(screen.promptId, text);
            }
          }}
          rows={3}
          autoFocus
          enterKeyHint="send"
          placeholder="Make the room laugh"
          className="resize-none rounded-2xl border-[3px] border-paper bg-paper px-4 py-3 text-xl font-bold text-ink placeholder:font-medium placeholder:text-ink/40"
        />
        <span className={`self-end text-sm font-bold tabular-nums ${left <= 5 ? "text-side-a" : "text-paper/60"}`}>
          {left} left
        </span>
      </label>

      <button type="submit" disabled={!canSend} className="press mt-4 bg-marigold py-5 text-2xl font-black text-ink">
        Send answer
      </button>
    </form>
  );
}

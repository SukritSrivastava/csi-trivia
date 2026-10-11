"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { loadLastName } from "@/lib/session";
import { usePlayerStore } from "@/stores/playerStore";
import { APP_NAME, NAME_MAX_LENGTH, ROOM_CODE_LENGTH } from "@/shared/protocol";

export function JoinForm() {
  const params = useSearchParams();
  const join = usePlayerStore((s) => s.join);
  const joining = usePlayerStore((s) => s.joining);
  const notice = usePlayerStore((s) => s.notice);

  const [code, setCode] = useState(() => (params.get("code") ?? "").toUpperCase().slice(0, ROOM_CODE_LENGTH));
  const [name, setName] = useState("");
  useEffect(() => setName(loadLastName()), []);

  const ready = code.length === ROOM_CODE_LENGTH && name.trim().length > 0;

  return (
    <main className="flex min-h-dvh flex-col bg-marigold px-5 pt-10 pb-8 text-ink">
      <h1 className="type-wide text-4xl font-black tracking-tight">{APP_NAME}</h1>
      <p className="mt-2 text-lg font-medium text-ink-soft">Enter the code on the TV.</p>

      <form
        className="mt-8 flex flex-1 flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) join(code, name);
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="text-base font-bold">Room code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, ROOM_CODE_LENGTH))}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="ABCD"
            className="type-wide rounded-2xl border-[3px] border-ink bg-paper px-4 py-3 text-4xl font-black tracking-[0.3em] uppercase placeholder:text-ink/25"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-base font-bold">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, NAME_MAX_LENGTH))}
            autoComplete="nickname"
            enterKeyHint="go"
            placeholder="What should the TV call you?"
            className="rounded-2xl border-[3px] border-ink bg-paper px-4 py-3 text-2xl font-bold placeholder:text-base placeholder:font-medium placeholder:text-ink/40"
          />
        </label>

        {notice && (
          <p className="rounded-xl bg-ink px-4 py-3 text-base font-semibold text-paper" role="alert">
            {notice}
          </p>
        )}

        <button
          type="submit"
          disabled={!ready || joining}
          className="press mt-auto bg-ink py-5 text-2xl font-black text-paper"
        >
          {joining ? "Joining" : "Join game"}
        </button>
      </form>
    </main>
  );
}

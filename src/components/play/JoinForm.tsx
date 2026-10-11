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
  const status = usePlayerStore((s) => s.status);

  const [code, setCode] = useState(() => cleanCode(params.get("code") ?? ""));
  const [name, setName] = useState("");
  useEffect(() => setName(loadLastName()), []);

  const ready = code.length === ROOM_CODE_LENGTH && name.trim().length > 0;

  return (
    <main className="flex min-h-dvh flex-col bg-marigold px-5 pt-8 pb-6 text-ink">
      <h1 className="type-wide text-[2.6rem] font-black leading-none tracking-tight">{APP_NAME}</h1>
      <p className="mt-2 text-lg font-medium text-ink-soft">Enter the code on the projector and your name.</p>

      <form
        className="mt-7 flex flex-1 flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !joining) join(code, name);
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="text-base font-bold">Room code</span>
          <input
            value={code}
            onChange={(e) => setCode(cleanCode(e.target.value))}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            enterKeyHint="next"
            placeholder="ABCD"
            aria-describedby={notice ? "join-notice" : undefined}
            className="type-wide w-full rounded-2xl border-[3px] border-ink bg-paper px-4 py-3 text-4xl font-black tracking-[0.3em] uppercase placeholder:text-ink/25"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-base font-bold">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, NAME_MAX_LENGTH))}
            autoComplete="name"
            autoCapitalize="words"
            enterKeyHint="go"
            placeholder="e.g. Riya Shah"
            aria-describedby={notice ? "join-notice" : undefined}
            className="w-full rounded-2xl border-[3px] border-ink bg-paper px-4 py-3 text-2xl font-bold placeholder:font-medium placeholder:text-ink/35"
          />
          <span className="text-sm text-ink-soft">Use your real name so the winner can be found.</span>
        </label>

        {notice && (
          <p id="join-notice" className="rounded-xl bg-ink px-4 py-3 text-base font-semibold text-paper" role="alert">
            {notice}
          </p>
        )}

        <div className="mt-auto pt-4">
          <button
            type="submit"
            disabled={!ready || joining}
            className="press w-full bg-ink py-5 text-2xl font-black text-paper"
          >
            {joining ? "Joining" : "Join quiz"}
          </button>
          {status === "offline" && (
            <p className="mt-3 text-center text-sm font-semibold text-ink-soft" role="status">
              Connecting to the quiz server
            </p>
          )}
        </div>
      </form>
    </main>
  );
}

function cleanCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, ROOM_CODE_LENGTH);
}

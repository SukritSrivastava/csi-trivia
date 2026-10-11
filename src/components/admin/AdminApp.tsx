"use client";

/**
 * PHASE 1: a bare organiser page, just enough to run and judge a full game.
 * Phase 3 builds the real organiser page.
 */
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useCountdown } from "@/lib/useCountdown";
import { useAdminStore } from "@/stores/adminStore";

export function AdminApp() {
  const connect = useAdminStore((s) => s.connect);
  const view = useAdminStore((s) => s.view);
  useEffect(() => connect(), [connect]);
  return (
    <main className="min-h-dvh bg-ink px-4 py-5 text-paper">
      <div className="mx-auto max-w-xl">{view ? <Controls /> : <SignIn />}</div>
    </main>
  );
}

function SignIn() {
  const params = useSearchParams();
  const signIn = useAdminStore((s) => s.signIn);
  const error = useAdminStore((s) => s.error);
  const [code, setCode] = useState(() => (params.get("code") ?? "").toUpperCase());
  const [pin, setPin] = useState("");
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        signIn(code, pin);
      }}
    >
      <h1 className="type-wide text-3xl font-black">Organiser</h1>
      <label className="flex flex-col gap-1">
        <span className="font-bold">Room code</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
          className="type-wide rounded-xl bg-paper px-3 py-2 text-3xl font-black tracking-[0.3em] text-ink"
          autoCapitalize="characters"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-bold">PIN</span>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          inputMode="numeric"
          type="password"
          className="rounded-xl bg-paper px-3 py-2 text-2xl font-black text-ink"
        />
      </label>
      {error && (
        <p className="rounded-lg bg-side-a px-3 py-2 font-bold text-ink" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="press bg-marigold py-4 text-xl font-black text-ink">
        Sign in
      </button>
    </form>
  );
}

function Controls() {
  const s = useAdminStore((state) => state);
  const view = s.view!;
  const countdown = useCountdown(view.timer, s.clockOffset);
  const judging = view.duel?.finalists.find((f) => f.id === view.judgingPlayerId);
  const btn = "press px-3 py-3 text-base font-black text-ink";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="type-wide text-2xl font-black">Room {view.roomCode}</h1>
        <button type="button" onClick={s.signOut} className="text-sm font-bold underline">
          Sign out
        </button>
      </div>
      <p className="rounded-xl bg-paper/10 px-3 py-2 font-bold">
        {view.stepLabel}
        {countdown && `, ${countdown.seconds}s left`}
        {view.paused && " (paused)"}
      </p>

      {view.awaitingJudge && (
        <div className="rounded-2xl bg-paper p-4 text-ink">
          <p className="text-lg font-black">Judge {judging?.name ?? "the finalist"}</p>
          {view.duelAnswer && <p className="mt-1">Answer: <b>{view.duelAnswer}</b></p>}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => s.judge(true)} className={`${btn} bg-side-b py-6 text-2xl`}>
              Correct
            </button>
            <button type="button" onClick={() => s.judge(false)} className={`${btn} bg-side-a py-6 text-2xl`}>
              Wrong
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button type="button" disabled={!view.canStart} onClick={s.start} className={`${btn} bg-marigold`}>
          Start quiz
        </button>
        {view.paused ? (
          <button type="button" onClick={s.resume} className={`${btn} bg-marigold`}>
            Resume
          </button>
        ) : (
          <button type="button" disabled={!view.timer} onClick={s.pause} className={`${btn} bg-paper`}>
            Pause
          </button>
        )}
        <button type="button" disabled={!view.timer} onClick={s.skip} className={`${btn} bg-paper`}>
          Skip this step
        </button>
        <button type="button" onClick={s.voidQuestion} className={`${btn} bg-paper`}>
          Void question
        </button>
        <button type="button" onClick={s.restartRound} className={`${btn} bg-paper`}>
          Restart round
        </button>
        <button type="button" onClick={s.downloadResults} className={`${btn} bg-paper`}>
          Results CSV
        </button>
      </div>

      <h2 className="mt-2 text-lg font-black">Players ({view.players.length})</h2>
      <ul className="divide-y divide-paper/10">
        {view.players.map((p) => (
          <li key={p.id} className="flex items-center gap-2 py-2 text-sm">
            <span className="h-3 w-3 rounded-full" style={{ background: p.connected ? p.color : "#666" }} />
            <span className="flex-1 truncate font-bold">{p.name}</span>
            <span className="text-paper/60">{p.status}</span>
            {p.awayCount > 0 && <span className="rounded bg-side-a px-1.5 font-bold text-ink">left page ×{p.awayCount}</span>}
            <span className="w-12 text-right tabular-nums">{p.roundScore}</span>
            {p.status !== "removed" && (
              <button type="button" onClick={() => s.remove(p.id)} className="text-xs font-bold underline">
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

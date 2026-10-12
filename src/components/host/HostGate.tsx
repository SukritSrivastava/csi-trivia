"use client";

/**
 * The projector before a room is on screen: the PIN (same as Admin's), then
 * "waiting for the quizmaster to open a room". Design extension in the corridor
 * look: the corridor behind a centred panel, terminal digits, a solid mint button.
 */
import { useState } from "react";
import { Corridor } from "@/components/ui/Corridor";
import { SERVER_RESTARTED_MESSAGE } from "@/shared/protocol";
import { useHostStore } from "@/stores/hostStore";

export function HostGate() {
  const stage = useHostStore((s) => s.stage);
  const status = useHostStore((s) => s.status);
  const error = useHostStore((s) => s.error);
  const signingIn = useHostStore((s) => s.signingIn);
  const signIn = useHostStore((s) => s.signIn);
  const signOut = useHostStore((s) => s.signOut);
  const restarted = useHostStore((s) => s.restarted);
  const [pin, setPin] = useState("");

  return (
    <main className="host-root relative grid min-h-dvh w-full place-items-center overflow-hidden bg-void font-type text-ghost">
      <Corridor scrim="center" />
      <div className="relative z-10 flex w-[44rem] max-w-[92vw] flex-col items-center gap-[2rem] text-center">
        <p className="font-term text-[7rem] leading-none text-mint [text-shadow:0_0_1.2rem_var(--color-mint)]">HERMES QUIZ</p>

        {status !== "online" ? (
          <p className="host-hint">{status === "connecting" ? "Connecting to the game server…" : "Can't reach the game server. Retrying…"}</p>
        ) : stage === "waiting" && restarted ? (
          <div className="flex flex-col items-center gap-[1.6rem]" data-testid="host-restarted">
            <p className="host-banner !text-[4.4rem]">&gt; server restarted</p>
            <p className="host-q host-q-center !text-[4rem]">{SERVER_RESTARTED_MESSAGE}</p>
            <p className="host-hint">The quizmaster opens it again from Admin. It appears here by itself.</p>
          </div>
        ) : stage === "waiting" ? (
          <>
            <p className="host-hint">Waiting for the quizmaster to open a room…</p>
            <p className="text-[1.6rem] text-fog">Admin → pick a quiz → Open room. It appears here by itself.</p>
            <button type="button" onClick={signOut} className="text-[1.5rem] text-fog underline underline-offset-4">
              Sign out
            </button>
          </>
        ) : (
          <form
            className="flex w-full flex-col gap-[1.4rem]"
            onSubmit={(e) => {
              e.preventDefault();
              if (pin.trim()) signIn(pin);
            }}
          >
            <label className="flex flex-col gap-[0.6rem] text-[1.8rem] text-mint-soft">
              Projector PIN (the same as Admin)
              <input
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoFocus
                autoCapitalize="characters"
                autoComplete="current-password"
                name="pin"
                className="rounded-[0.9rem] border-2 border-line bg-void px-[1.4rem] py-[1rem] text-center font-term text-[4rem] leading-none tracking-[0.3em] text-ghost outline-none focus:border-mint"
              />
            </label>
            {error && (
              <p className="text-[1.8rem] text-wrong" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="phone-go w-full py-[1rem] text-[3rem]" disabled={!pin.trim() || signingIn} data-testid="host-sign-in">
              {signingIn ? "…" : "SHOW QUIZ"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

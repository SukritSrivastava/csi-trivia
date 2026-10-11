"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ROOM_CODE_LENGTH } from "@/shared/protocol";
import { useAdminStore } from "@/stores/adminStore";

const input =
  "w-full rounded-[0.9rem] border-2 border-line bg-void px-4 py-3 text-ghost outline-none transition-colors focus:border-mint";

/** Room code (prefilled from /admin?code=ABCD) and PIN. */
export function SignIn() {
  const params = useSearchParams();
  const signIn = useAdminStore((s) => s.signIn);
  const signingIn = useAdminStore((s) => s.signingIn);
  const error = useAdminStore((s) => s.error);
  const status = useAdminStore((s) => s.status);
  const [code, setCode] = useState(() => (params.get("code") ?? "").toUpperCase().slice(0, ROOM_CODE_LENGTH));
  const [pin, setPin] = useState("");
  const ready = code.length === ROOM_CODE_LENGTH && pin.length > 0 && !signingIn && status === "online";

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-5 py-10">
      <div>
        <p className="font-term text-2xl leading-none text-mint [text-shadow:0_0_8px_var(--color-mint)]">hermes://admin</p>
        <h1 className="mt-2 text-3xl leading-tight text-bright">Quizmaster sign in</h1>
        <p className="mt-2 text-[15px] text-mint-soft">The room code is on the Host screen.</p>
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) signIn(code, pin);
        }}
      >
        <label className="flex flex-col gap-1.5 text-[15px] text-mint-soft">
          Room code
          <input
            className={`${input} font-term text-4xl leading-none tracking-[0.3em] uppercase`}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^a-z]/gi, "").toUpperCase().slice(0, ROOM_CODE_LENGTH))}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            name="code"
            aria-invalid={error?.includes("code") || undefined}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[15px] text-mint-soft">
          PIN
          <input
            className={`${input} font-term text-4xl leading-none tracking-[0.3em]`}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            name="pin"
          />
        </label>

        {error && (
          <p className="rounded-[0.9rem] border-2 border-wrong bg-wrong/10 px-4 py-3 text-[15px] text-wrong" role="alert">
            {error}
          </p>
        )}
        {status !== "online" && (
          <p className="text-[15px] text-fog" role="status">
            {status === "connecting" ? "Connecting to the quiz server…" : "Can't reach the quiz server. Retrying…"}
          </p>
        )}

        <button type="submit" className="phone-go min-h-16 w-full" disabled={!ready} data-testid="sign-in">
          {signingIn ? "SIGNING IN…" : "SIGN IN"}
        </button>
      </form>
    </main>
  );
}

"use client";

/**
 * Join: the room code (prefilled from the QR link /play?code=ABCD) and a real
 * name. Inputs are 18 px so iPhone doesn't zoom; errors in wrong-red. The last
 * name typed on this phone is filled in.
 */
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Bot } from "@/components/ui/Bot";
import { loadLastName } from "@/lib/session";
import { NAME_MAX_LENGTH } from "@/shared/protocol";
import { useParticipantStore } from "@/stores/participantStore";
import { PhoneTitle } from "./parts";

const inputClass =
  "w-full rounded-[0.9rem] border-2 border-line bg-void/70 px-4 py-3 text-[1.15rem] text-ghost outline-none transition-colors focus:border-mint focus-visible:outline-none";

export function JoinScreen() {
  const params = useSearchParams();
  const join = useParticipantStore((s) => s.join);
  const joining = useParticipantStore((s) => s.joining);
  const notice = useParticipantStore((s) => s.notice);
  const [code, setCode] = useState(() => (params.get("code") ?? "").replace(/[^a-z]/gi, "").slice(0, 4).toUpperCase());
  const [name, setName] = useState("");

  useEffect(() => setName((n) => n || loadLastName()), []);

  const ready = code.length === 4 && name.trim().length > 0;
  return (
    <form
      className="flex flex-1 flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) join(code, name);
      }}
      data-testid="join-form"
    >
      <div className="flex items-center gap-4 pt-2">
        <Bot color="#6cf0b0" head="antenna" size="64px" />
        <div>
          <p className="font-term text-[1.4rem] leading-none text-mint">hermes://quiz</p>
          <PhoneTitle>Join the quiz</PhoneTitle>
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-base opacity-80">Room code (on the projector)</span>
        <input
          className={`${inputClass} font-term !text-[2.4rem] leading-none tracking-[0.45em] uppercase`}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^a-z]/gi, "").slice(0, 4).toUpperCase())}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          name="code"
          aria-label="Room code"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-base opacity-80">Your real name</span>
        <input
          className={inputClass}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={NAME_MAX_LENGTH}
          autoComplete="given-name"
          autoCapitalize="words"
          enterKeyHint="go"
          name="name"
          aria-label="Your real name"
        />
        <span className="text-sm opacity-60">It goes up on the projector.</span>
      </label>

      {notice && (
        <p className="rounded-[0.9rem] border-2 border-wrong bg-wrong/10 px-4 py-3 text-base text-wrong" role="alert" data-testid="join-error">
          {notice}
        </p>
      )}

      <button type="submit" className="phone-go mt-auto !text-[2.2rem] transition-transform active:scale-[0.98]" disabled={joining || !ready} data-testid="join">
        {joining ? "JOINING…" : "JOIN"}
      </button>
    </form>
  );
}

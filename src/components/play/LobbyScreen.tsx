"use client";

/**
 * Lobby = "Build your bot", exactly the finaldesign.html builder: big preview,
 * the 12 swatches plus the colour wheel, 8 heads, and LOCK IN, which folds it
 * into "You're in" with the bot idle and the joined count. They can reopen it
 * until the quiz starts (the lobby screen goes away by itself then).
 */
import { useEffect, useState } from "react";
import { Bot } from "@/components/ui/Bot";
import { BotBuilder } from "@/components/ui/BotBuilder";
import type { ParticipantView } from "@/shared/protocol";
import { useParticipantStore } from "@/stores/participantStore";
import { PhoneTitle } from "./parts";

const lockKey = (id: string) => `hermes:bot-locked:${id}`;

export function LobbyScreen({ view, joined }: { view: ParticipantView; joined: number }) {
  const setBot = useParticipantStore((s) => s.setBot);
  const botPending = useParticipantStore((s) => s.botPending);
  const botNotice = useParticipantStore((s) => s.botNotice);
  const me = view.me;
  const [locked, setLocked] = useState(false);

  // Remember LOCK IN across a refresh (this tab only).
  useEffect(() => {
    try {
      setLocked(sessionStorage.getItem(lockKey(me.id)) === "1");
    } catch {
      // Storage blocked: start open.
    }
  }, [me.id]);
  const lock = (value: boolean) => {
    setLocked(value);
    try {
      if (value) sessionStorage.setItem(lockKey(me.id), "1");
      else sessionStorage.removeItem(lockKey(me.id));
    } catch {
      // Storage blocked: fine for this visit.
    }
  };

  const count = (
    <p className="text-center text-[1.05rem] opacity-85" data-testid="joined-count">
      <span className="font-term text-[1.9rem] leading-none text-amber">{joined}</span> {joined === 1 ? "bot" : "bots"} in the room
    </p>
  );

  if (locked) {
    return (
      <div className="my-auto flex flex-col items-center gap-5 py-4 text-center" data-testid="lobby-locked">
        <Bot color={me.color} head={me.head} mood="idle" size="clamp(120px, 40vw, 168px)" label="Your bot" />
        <p className="phone-result !text-[clamp(3rem,15vw,4.4rem)]">YOU&apos;RE IN</p>
        <p className="max-w-[20rem] text-[1.15rem] leading-snug opacity-85">Look up at the projector. The quiz starts soon.</p>
        {count}
        <button type="button" className="phone-opt mt-2 justify-center px-6 text-[1.1rem]" onClick={() => lock(false)} data-testid="change-bot">
          Change my bot
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3" data-testid="bot-builder">
      <PhoneTitle>Build your bot</PhoneTitle>
      <BotBuilder value={{ color: me.color, head: me.head }} onPick={setBot} busy={botPending} previewSize="clamp(96px, 30vw, 128px)" />
      {botNotice && (
        <p className="text-base text-wrong" role="alert" data-testid="bot-error">
          {botNotice}
        </p>
      )}
      {count}
      <div className="sticky bottom-0 -mx-1 mt-auto bg-gradient-to-t from-deep via-deep/90 to-transparent px-1 pt-4 pb-1">
        <button type="button" className="phone-go w-full !text-[2.2rem] transition-transform active:scale-[0.98]" onClick={() => lock(true)} data-testid="lock-in">
          LOCK IN
        </button>
      </div>
    </div>
  );
}

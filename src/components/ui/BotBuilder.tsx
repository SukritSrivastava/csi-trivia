"use client";

import { useEffect, useState } from "react";
import { BOT_HEADS, type BotHead, type BotLook, type BotPicker, PARTICIPANT_COLORS } from "@/shared/protocol";
import { Bot } from "./Bot";

interface BotBuilderProps {
  /** The participant's current bot (ParticipantView.me). */
  value: BotLook;
  /** From the lobby screen: what's locked or taken by others. */
  picker: BotPicker;
  /** Send the choice (participant:bot). The server has the final say. */
  onPick: (look: BotLook) => void;
  /** Ignore taps while a choice is on its way. */
  busy?: boolean;
}

/**
 * The phone's "Build your bot" panel from public/finaldesign.html: a big
 * preview, 12 colours (taken ones greyed and crossed), 8 heads (heads taken in
 * the chosen colour greyed). The preview hops for a moment after each change.
 */
export function BotBuilder({ value, picker, onPick, busy = false }: BotBuilderProps) {
  const [cheer, setCheer] = useState(false);
  const key = `${value.color}|${value.head}`;

  useEffect(() => {
    setCheer(true);
    const id = window.setTimeout(() => setCheer(false), 1700);
    return () => window.clearTimeout(id);
  }, [key]);

  const colourLocked = (c: string) => picker.lockedColors.includes(c);
  const headTaken = (color: string, h: BotHead) => picker.taken.some((t) => t.color === color && t.head === h);

  const pickColour = (color: string) => {
    if (busy || colourLocked(color) || color === value.color) return;
    // Keep the head if it's free in the new colour, otherwise take the first free one.
    const head = headTaken(color, value.head) ? BOT_HEADS.find((h) => !headTaken(color, h)) : value.head;
    if (head) onPick({ color, head });
  };
  const pickHead = (head: BotHead) => {
    if (busy || head === value.head || headTaken(value.color, head)) return;
    onPick({ color: value.color, head });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid place-items-center py-2">
        <Bot color={value.color} head={value.head} mood={cheer ? "right" : "idle"} size="72px" label="Your bot" />
      </div>

      <p className="text-sm opacity-75">Colour</p>
      <div className="grid grid-cols-6 gap-3" role="group" aria-label="Bot colour">
        {PARTICIPANT_COLORS.map((c) => {
          const locked = colourLocked(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => pickColour(c)}
              disabled={locked}
              aria-pressed={c === value.color}
              aria-label={locked ? "Colour taken" : "Pick this colour"}
              className="relative aspect-square rounded-full disabled:cursor-not-allowed disabled:opacity-30 aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-ghost"
              style={{ background: c }}
            >
              {locked && <span className="absolute inset-x-[10%] top-1/2 h-0.5 -rotate-45 bg-ghost" aria-hidden />}
            </button>
          );
        })}
      </div>

      <p className="text-sm opacity-75">Head</p>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Bot head">
        {BOT_HEADS.map((h) => {
          const taken = headTaken(value.color, h);
          return (
            <button
              key={h}
              type="button"
              onClick={() => pickHead(h)}
              disabled={taken}
              aria-pressed={h === value.head}
              aria-label={taken ? `${h} head, taken in this colour` : `${h} head`}
              className="grid place-items-center rounded-lg border-[1.5px] border-transparent px-0.5 pt-2 pb-1 disabled:cursor-not-allowed disabled:opacity-30 aria-pressed:border-mint aria-pressed:bg-mint/10"
            >
              <Bot color={value.color} head={h} size="30px" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

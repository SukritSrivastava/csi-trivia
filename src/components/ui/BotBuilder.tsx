"use client";

import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { BOT_HEADS, type BotHead, type BotLook, hexToHsl, hslToHex, normalizeBotColor, PARTICIPANT_COLORS } from "@/shared/protocol";
import { Bot } from "./Bot";

interface BotBuilderProps {
  /** The participant's current bot (ParticipantView.me). */
  value: BotLook;
  /** Send the choice (participant:bot). The server has the final say. */
  onPick: (look: BotLook) => void;
  /** Ignore taps while a choice is on its way. */
  busy?: boolean;
  /** Size of the big preview bot. */
  previewSize?: string;
}

/**
 * The phone's "Build your bot" panel from public/finaldesign.html: a big
 * preview, the 12 colour swatches, 8 heads. Extension (12 Oct): a colour wheel
 * for any colour, and nothing is ever taken (100 people can share colours and
 * heads; names tell them apart). The preview hops for a moment after each change.
 */
export function BotBuilder({ value, onPick, busy = false, previewSize = "72px" }: BotBuilderProps) {
  const [cheer, setCheer] = useState(false);
  /** The colour under the finger while dragging on the wheel (sent on release). */
  const [draft, setDraft] = useState<string | null>(null);
  const key = `${value.color}|${value.head}`;
  const shown = draft ?? value.color;

  useEffect(() => {
    setCheer(true);
    setDraft(null); // the server's answer arrived: show the real bot
    const id = window.setTimeout(() => setCheer(false), 1700);
    return () => window.clearTimeout(id);
  }, [key]);

  /** Wheel released: keep showing the dragged colour until the server's answer (or 2 s, if it refuses). */
  const finishWheel = (color: string) => {
    pickColour(color);
    window.setTimeout(() => setDraft(null), 2000);
  };

  const pickColour = (color: string) => {
    const c = normalizeBotColor(color);
    if (busy || !c || c === value.color.toLowerCase()) return;
    onPick({ color: c, head: value.head });
  };
  const pickHead = (head: BotHead) => {
    if (busy || head === value.head) return;
    onPick({ color: value.color, head });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid place-items-center py-2">
        <Bot color={shown} head={value.head} mood={cheer ? "right" : "idle"} size={previewSize} label="Your bot" />
      </div>

      <p className="text-sm opacity-75">Colour</p>
      <div className="grid grid-cols-6 gap-3" role="group" aria-label="Bot colour">
        {PARTICIPANT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => pickColour(c)}
            aria-pressed={c.toLowerCase() === value.color.toLowerCase()}
            aria-label="Pick this colour"
            className="relative aspect-square rounded-full aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-ghost"
            style={{ background: c }}
          />
        ))}
      </div>

      <p className="text-sm opacity-75">Head</p>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Bot head">
        {BOT_HEADS.map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => pickHead(h)}
            aria-pressed={h === value.head}
            aria-label={`${h} head`}
            className="grid place-items-center rounded-lg border-[1.5px] border-transparent px-0.5 pt-2 pb-1 aria-pressed:border-mint aria-pressed:bg-mint/10"
          >
            <Bot color={shown} head={h} size="34px" />
          </button>
        ))}
      </div>

      <p className="text-sm opacity-75">Or any colour</p>
      <ColourWheel value={shown} onDrag={setDraft} onDone={finishWheel} disabled={busy} />
    </div>
  );
}

/** Lightness at the wheel's rim (full colour) and at its centre (palest), in %. */
const RIM_L = 60;
const CENTRE_L = 88;

/** Hue (angle, clockwise from the top) and how far out (0 centre … 1 rim) → a colour. */
const wheelColour = (hue: number, out: number) => hslToHex(hue, 100 * out, CENTRE_L - (CENTRE_L - RIM_L) * out);

/**
 * A colour wheel: around = hue, inwards = paler. Drag (or tap) to choose; the
 * colour is sent when the finger lifts. Arrow keys change the hue.
 */
function ColourWheel({ value, onDrag, onDone, disabled }: { value: string; onDrag: (c: string) => void; onDone: (c: string) => void; disabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const last = useRef(value);
  const { h, s } = hexToHsl(value);
  // Marker position from the current colour (hue → angle, saturation → distance).
  const out = Math.min(1, s / 100);
  const angle = (h * Math.PI) / 180;
  const marker = { left: `${50 + 50 * out * Math.sin(angle)}%`, top: `${50 - 50 * out * Math.cos(angle)}%` };

  const colourAt = (e: PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (box.left + box.width / 2);
    const dy = e.clientY - (box.top + box.height / 2);
    const hue = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    const dist = Math.min(1, Math.hypot(dx, dy) / (box.width / 2));
    return wheelColour(hue, dist);
  };

  const onKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 15 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -15 : 0;
    if (!step || disabled) return;
    e.preventDefault();
    onDone(wheelColour((h + step + 360) % 360, Math.max(0.6, out)));
  };

  return (
    <div className="flex justify-center">
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label="Colour wheel"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(h)}
        aria-valuetext={value}
        aria-disabled={disabled}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          if (disabled) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          last.current = colourAt(e);
          onDrag(last.current);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          last.current = colourAt(e);
          onDrag(last.current);
        }}
        onPointerUp={() => {
          if (!dragging.current) return;
          dragging.current = false;
          onDone(last.current);
        }}
        onPointerCancel={() => {
          dragging.current = false;
          onDone(last.current);
        }}
        className="relative aspect-square w-[min(100%,11rem)] touch-none rounded-full border-2 border-line outline-offset-4 select-none aria-disabled:opacity-50"
        style={{
          // no-glow: allow (the colour wheel's pale centre: a colour picker, not a light)
          background: `radial-gradient(circle closest-side, ${wheelColour(0, 0)}, transparent), conic-gradient(${Array.from({ length: 13 }, (_, i) => wheelColour(i * 30, 1)).join(", ")})`,
        }}
      >
        <span
          className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-ghost outline-2 outline-void"
          style={{ ...marker, background: value }}
          aria-hidden
        />
      </div>
    </div>
  );
}

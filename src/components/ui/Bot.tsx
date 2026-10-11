import type { CSSProperties } from "react";
import type { BotHead, BotMood } from "@/shared/protocol";

interface BotProps {
  /** One of PARTICIPANT_COLORS. */
  color: string;
  head: BotHead;
  /** What the eyes are doing. On the Host, use HostView.cast[i].mood. */
  mood?: BotMood;
  /** The bot's width, any CSS length: "6rem" on the Host, "64px" on a phone. */
  size?: string;
  /** Seconds to offset the idle animations, so a wall of bots doesn't blink in sync. */
  delay?: number;
  /** Accessible label. Leave out when a name is printed next to the bot. */
  label?: string;
  className?: string;
}

/**
 * A participant's robot. Every state and animation lives in globals.css
 * (.bot, data-head, data-mood), copied exactly from public/finaldesign.html.
 * Changing `mood` restarts the matching animation (hop for right, shake for wrong).
 */
export function Bot({ color, head, mood = "idle", size = "44px", delay = 0, label, className = "" }: BotProps) {
  const style = { "--c": color, "--d": `${delay}s`, fontSize: size } as CSSProperties;
  return (
    <span
      className={`bot ${className}`}
      data-head={head}
      data-mood={mood}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <i className="bot-head" />
      <i className="bot-eyes">
        <i className="bot-eye">
          <i className="bot-pupil" />
        </i>
        <i className="bot-eye">
          <i className="bot-pupil" />
        </i>
      </i>
      <i className="bot-mouth" />
    </span>
  );
}

/** A stable, small delay per bot from its id, so neighbours never blink together. */
export function botDelay(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return (h % 40) / 10; // 0–3.9 s
}

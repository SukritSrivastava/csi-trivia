interface CorridorProps {
  /**
   * Dark pools that keep text readable over the corridor:
   * - split:  question on the left, answers on the right (Round 1 answer step)
   * - center: one block of text in the middle (read step, intros, reveals)
   * - full:   a big centred panel (leaderboards, lists, podium)
   * - none:   just the corridor (lobby behind its own panels)
   */
  scrim?: "split" | "center" | "full" | "none";
  /** The red alarm pulse from above. On by default. */
  alarm?: boolean;
  /** Seconds per alarm pulse (3.2 in the design; faster when buzzers are open). */
  alarmSeconds?: number;
}

/**
 * The Host background: the server-room corridor from public/finaldesign.html.
 * Fills its nearest positioned parent; put it first inside a `relative` box
 * and the screen's content after it with a higher z-index.
 */
export function Corridor({ scrim = "split", alarm = true, alarmSeconds }: CorridorProps) {
  return (
    <div className="corridor" aria-hidden>
      <i className="corridor-ceil" />
      <i className="corridor-floor" />
      <i className="corridor-left" />
      <i className="corridor-right" />
      <i className="corridor-end" />
      {alarm && <i className="corridor-alarm" style={alarmSeconds ? { animationDuration: `${alarmSeconds}s` } : undefined} />}
      {scrim !== "none" && <i className={`corridor-scrim-${scrim}`} />}
      <i className="corridor-vignette" />
    </div>
  );
}

"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { roundTitle } from "@/lib/format";
import type { HostStage, HostView } from "@/shared/protocol";

type Stage = Extract<HostStage, { phase: "scores" }>;

/**
 * The leaderboard opens in the order from before this round, then the bars
 * grow and the rows shuffle into the new order. That shuffle is the moment.
 */
export function ScoresStage({ view, stage }: { view: HostView; stage: Stage }) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(true), 900);
    return () => window.clearTimeout(id);
  }, []);

  const rows = view.players.map((p) => {
    const gain = stage.gains[p.id] ?? 0;
    return { ...p, gain, before: p.score - gain };
  });
  const shown = [...rows].sort((a, b) => (settled ? b.score - a.score : b.before - a.before));
  const top = Math.max(1, ...rows.map((r) => r.score));

  return (
    <div className="flex w-full max-w-[100rem] flex-col gap-[2.5rem]">
      <h1 className="type-wide text-[5rem] font-black leading-none tracking-tight">
        Scores after {roundTitle(stage.round.index, stage.round.kind).toLowerCase()}
      </h1>
      <ol className="flex flex-col gap-[1rem]">
        {shown.map((p) => {
          const value = settled ? p.score : p.before;
          return (
            <motion.li
              key={p.id}
              layout
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
              className="plate flex items-center gap-[1.5rem] px-[1.5rem] py-[0.9rem]"
            >
              <Avatar name={p.name} color={p.color} size={4} dimmed={!p.connected} />
              <span className="w-[14rem] truncate text-[2rem] font-black">{p.name}</span>
              <div className="relative h-[2.6rem] flex-1 overflow-hidden rounded-full bg-ink/10">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: p.color }}
                  initial={false}
                  animate={{ width: `${(value / top) * 100}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                />
              </div>
              <span className="type-wide w-[10rem] text-right text-[2.4rem] font-black tabular-nums">{value}</span>
              <span className="w-[8rem] text-right text-[1.6rem] font-bold text-ink-soft tabular-nums">
                {p.gain > 0 ? `+${p.gain}` : ""}
              </span>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}

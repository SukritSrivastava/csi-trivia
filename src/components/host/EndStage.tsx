"use client";

import { motion } from "motion/react";
import { Avatar } from "@/components/ui/Avatar";
import { ordinal } from "@/lib/format";
import { useHostStore } from "@/stores/hostStore";
import type { HostStage, HostView } from "@/shared/protocol";

type Stage = Extract<HostStage, { phase: "end" }>;

export function EndStage({ view, stage }: { view: HostView; stage: Stage }) {
  const newRoom = useHostStore((s) => s.newRoom);
  const winners = view.players.filter((p) => stage.winnerIds.includes(p.id));
  const ranked = [...view.players].sort((a, b) => b.score - a.score);
  const headline =
    winners.length === 1 ? `${winners[0].name} wins` : `${winners.map((w) => w.name).join(" and ")} tie`;

  return (
    <div className="flex w-full max-w-[100rem] flex-col items-center gap-[3rem] text-center">
      <div className="flex gap-[1.5rem]">
        {winners.map((w, i) => (
          <motion.div
            key={w.id}
            initial={{ y: -200, rotate: -20 }}
            animate={{ y: 0, rotate: 0 }}
            transition={{ delay: i * 0.15, type: "spring", stiffness: 180, damping: 12 }}
          >
            <Avatar name={w.name} color={w.color} size={12} />
          </motion.div>
        ))}
      </div>
      <motion.h1
        className="type-wide text-[8rem] font-black leading-[0.95] tracking-tight text-balance"
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.3, type: "spring", stiffness: 200, damping: 14 }}
      >
        {headline}
      </motion.h1>

      <ol className="grid w-full max-w-[70rem] grid-cols-2 gap-[1rem] text-left">
        {ranked.map((p) => {
          const rank = 1 + ranked.filter((o) => o.score > p.score).length;
          return (
            <li key={p.id} className="plate flex items-center gap-[1rem] px-[1.4rem] py-[0.8rem]">
              <span className="w-[4rem] text-[1.8rem] font-black text-ink-soft">{ordinal(rank)}</span>
              <Avatar name={p.name} color={p.color} size={3.2} />
              <span className="flex-1 truncate text-[1.8rem] font-black">{p.name}</span>
              <span className="type-wide text-[1.9rem] font-black tabular-nums">{p.score}</span>
            </li>
          );
        })}
      </ol>

      <div className="flex items-center gap-[2rem] text-[1.8rem] font-semibold">
        <p>The VIP can start another game from their phone.</p>
        <button type="button" onClick={newRoom} className="font-bold underline underline-offset-4">
          Or start a new room
        </button>
      </div>
    </div>
  );
}

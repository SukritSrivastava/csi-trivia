"use client";

import { motion } from "motion/react";
import { Avatar } from "@/components/ui/Avatar";
import type { HostStage, HostView } from "@/shared/protocol";
import { PromptHeader, SIDE_COLORS } from "./PromptHeader";

type Stage = Extract<HostStage, { phase: "vote" }>;

export function VoteStage({ view, stage }: { view: HostView; stage: Stage }) {
  const isDuel = stage.round.kind === "duel";
  const voted = new Set(stage.votedIds);

  return (
    <div className="flex w-full max-w-[120rem] flex-col gap-[3rem]">
      <PromptHeader
        view={view}
        prompt={stage.prompt}
        matchupIndex={stage.matchupIndex}
        matchupCount={stage.matchupCount}
      />

      {isDuel ? (
        <div className="grid grid-cols-2 gap-[4rem] px-[2rem]">
          {stage.options.map((option, i) => (
            <motion.div
              key={option.id}
              className="plate grid min-h-[22rem] place-items-center px-[3rem] py-[3rem] text-center"
              style={{ background: SIDE_COLORS[i] }}
              initial={{ x: i === 0 ? -120 : 120, opacity: 0, rotate: 0 }}
              animate={{ x: 0, opacity: 1, rotate: i === 0 ? -1.5 : 1.5 }}
              transition={{ delay: 0.15 + i * 0.35, type: "spring", stiffness: 200, damping: 18 }}
            >
              <p className="text-[4.4rem] font-black leading-[1.1] text-balance">{option.text}</p>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-[2rem]">
          {stage.options.map((option, i) => (
            <motion.div
              key={option.id}
              className="plate grid min-h-[10rem] place-items-center px-[2rem] py-[1.6rem] text-center"
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1 * i }}
            >
              <p className="text-[2.6rem] font-black leading-tight text-balance">{option.text}</p>
            </motion.div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-center gap-[2rem]">
        <p className="type-wide text-[2.6rem] font-black">Vote on your phone</p>
        <div className="flex gap-[0.6rem]" aria-label={`${voted.size} votes in`}>
          {view.players.map((p) => (
            <Avatar key={p.id} name={p.name} color={p.color} size={3.2} dimmed={!voted.has(p.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

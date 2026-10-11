"use client";

import { motion } from "motion/react";
import { roundTitle } from "@/lib/format";
import type { RoundInfo } from "@/shared/protocol";

const RULES: Record<string, string> = {
  duel: "You'll get two prompts on your phone. Every prompt goes to two players, and everyone else votes for the funnier answer.",
  final: "Everyone answers the same prompt. Everyone votes. Triple points.",
};

export function IntroStage({ round }: { round: RoundInfo }) {
  return (
    <div className="flex max-w-[90rem] flex-col items-center text-center">
      <motion.h1
        className="type-wide text-[12rem] font-black leading-[0.9] tracking-tight"
        initial={{ scale: 0.4, rotate: -6 }}
        animate={{ scale: 1, rotate: -2 }}
        transition={{ type: "spring", stiffness: 220, damping: 14 }}
      >
        {roundTitle(round.index, round.kind)}
      </motion.h1>
      {round.kind === "duel" && round.multiplier > 1 && (
        <p className="mt-[2rem] rounded-full bg-ink px-[2rem] py-[0.6rem] text-[2.4rem] font-black text-marigold">
          Double points
        </p>
      )}
      <p className="mt-[2.5rem] max-w-[60rem] text-[2.2rem] font-semibold text-ink-soft">{RULES[round.kind]}</p>
    </div>
  );
}

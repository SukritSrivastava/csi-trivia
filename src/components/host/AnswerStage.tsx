"use client";

import { motion } from "motion/react";
import { Avatar } from "@/components/ui/Avatar";
import { TimerRing } from "@/components/ui/TimerRing";
import { useHostStore } from "@/stores/hostStore";
import type { HostStage, HostView } from "@/shared/protocol";

type Stage = Extract<HostStage, { phase: "answer" }>;

export function AnswerStage({ view, stage }: { view: HostView; stage: Stage }) {
  const clockOffset = useHostStore((s) => s.clockOffset);
  const done = new Set(stage.submittedIds);

  return (
    <div className="flex w-full max-w-[100rem] flex-col items-center gap-[3.5rem] text-center">
      <h1 className="type-wide text-[6.5rem] font-black leading-none tracking-tight">Answer on your phone</h1>
      <TimerRing timer={view.timer} clockOffset={clockOffset} size={14} />
      <ul className="flex flex-wrap justify-center gap-[2.5rem]" aria-label="Who has answered">
        {view.players.map((p) => {
          const finished = done.has(p.id);
          return (
            <li key={p.id} className="flex w-[9rem] flex-col items-center gap-[0.6rem]">
              <motion.div
                animate={finished ? { y: [0, -18, 0], rotate: [0, -8, 0] } : { y: 0 }}
                transition={{ duration: 0.45 }}
                className="relative"
              >
                <Avatar name={p.name} color={p.color} size={6} dimmed={!finished} />
                {finished && (
                  <span className="absolute -right-[0.4rem] -bottom-[0.4rem] grid h-[2.6rem] w-[2.6rem] place-items-center rounded-full border-[0.2rem] border-ink bg-paper text-[1.4rem] font-black">
                    ✓
                  </span>
                )}
              </motion.div>
              <span className="w-full truncate text-[1.5rem] font-bold">{p.name}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-[1.8rem] font-semibold text-ink-soft" aria-live="polite">
        {done.size} of {view.players.length} done
      </p>
    </div>
  );
}

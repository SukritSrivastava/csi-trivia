"use client";

import { TimerRing } from "@/components/ui/TimerRing";
import { useHostStore } from "@/stores/hostStore";
import type { HostView } from "@/shared/protocol";

interface PromptHeaderProps {
  view: HostView;
  prompt: string;
  matchupIndex: number;
  matchupCount: number;
}

/** The prompt card across the top of the vote and reveal screens. */
export function PromptHeader({ view, prompt, matchupIndex, matchupCount }: PromptHeaderProps) {
  const clockOffset = useHostStore((s) => s.clockOffset);
  return (
    <div className="flex w-full items-center gap-[2.5rem]">
      <div className="plate flex-1 px-[3rem] py-[2.2rem]">
        {matchupCount > 1 && (
          <p className="text-[1.4rem] font-bold text-ink-soft">
            Prompt {matchupIndex + 1} of {matchupCount}
          </p>
        )}
        <h1 className="mt-[0.3rem] text-[4rem] font-black leading-[1.1] text-balance">{prompt}</h1>
      </div>
      <TimerRing timer={view.timer} clockOffset={clockOffset} size={10} />
    </div>
  );
}

/** Pink on the left, teal on the right. The phones use the same colours. */
export const SIDE_COLORS = ["var(--color-side-a)", "var(--color-side-b)"];

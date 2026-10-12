"use client";

/**
 * The podium: 1st, 2nd and 3rd on server-rack plinths that rise in turn (3rd,
 * 2nd, then 1st), the winner hops (mood from the server), confetti in the bots'
 * own colours, the other finalists below, and how many of the audience called it.
 */
import NumberFlow from "@number-flow/react";
import { motion } from "motion/react";
import { useEffect } from "react";
import { Bot, botDelay } from "@/components/ui/Bot";
import { celebrate } from "@/lib/confetti";
import type { HostStage, HostView, PodiumEntry } from "@/shared/protocol";
import { contentTop, useMoods } from "../parts";

type PodiumData = Extract<HostStage, { phase: "podium" }>;

const PLINTH = { 1: { h: "13rem", delay: 1.4, bot: "11rem" }, 2: { h: "9rem", delay: 0.7, bot: "8rem" }, 3: { h: "6.5rem", delay: 0.1, bot: "8rem" } } as const;

export function PodiumStage({ view, stage }: { view: HostView; stage: PodiumData }) {
  const mood = useMoods(view);
  const [first, second, third] = stage.entries;
  const rest = stage.entries.slice(3, 12);

  useEffect(() => {
    const colours = stage.entries.slice(0, 6).map((e) => e.color);
    const t = window.setTimeout(() => void celebrate("big", colours), 2100);
    return () => window.clearTimeout(t);
  }, [stage.entries]);

  const plinth = (e: PodiumEntry | undefined, place: 1 | 2 | 3) => {
    if (!e) return <div className="w-[20rem]" />;
    const p = PLINTH[place];
    return (
      <div className="flex w-[20rem] flex-col items-center gap-[1rem]">
        <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: p.delay + 0.35, type: "spring", stiffness: 220, damping: 16 }} className="flex flex-col items-center gap-[0.8rem]">
          <span className={place === 1 ? "drop-shadow-[0_0_1.6rem_var(--color-mint)]" : ""}>
            <Bot color={e.color} head={e.head} mood={mood(e.id, place === 1 ? "right" : "idle")} size={p.bot} delay={botDelay(e.id)} />
          </span>
          <span className="host-name max-w-[20rem] truncate" style={{ fontSize: place === 1 ? "3.4rem" : "2.6rem" }}>
            {e.name}
          </span>
          <span className="font-term text-[3.4rem] leading-none text-amber">
            {e.points} {stage.basis === "buzzer" ? (e.points === 1 ? "pt" : "pts") : ""}
          </span>
        </motion.div>
        {/* A server-rack plinth: dark rack with LED dots, the place in terminal digits. */}
        <motion.div
          className="relative w-full overflow-hidden rounded-t-[0.8rem] border-2 border-line bg-rack"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgb(108 240 176 / 0.55) 0 0.2rem, transparent 0.32rem), repeating-linear-gradient(0deg, transparent 0 2.2rem, #030506 2.2rem 2.5rem)",
            backgroundSize: "2.4rem 2.5rem, 100% 100%",
          }}
          initial={{ height: 0 }}
          animate={{ height: p.h }}
          transition={{ delay: p.delay, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="absolute inset-x-0 top-[1rem] text-center font-term text-[7rem] leading-none text-amber [text-shadow:0_0_1.2rem_rgb(255_182_39/0.6)]">{place}</span>
        </motion.div>
      </div>
    );
  };

  return (
    <div className="absolute inset-x-[6%] bottom-[8%] z-10 flex flex-col items-center gap-[2.4rem]" style={{ top: contentTop(view.cast.length) }}>
      <motion.h2 className="host-q host-q-center !text-[5rem]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2 }}>
        {first ? `${first.name} wins!` : "The quiz is over"}
      </motion.h2>
      <div className="flex flex-1 items-end justify-center gap-[3rem]">
        {plinth(second, 2)}
        {plinth(first, 1)}
        {plinth(third, 3)}
      </div>
      {rest.length > 0 && (
        <motion.ul className="flex flex-wrap justify-center gap-x-[3rem] gap-y-[1rem]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.4 }}>
          {rest.map((e) => (
            <li key={e.id} className="flex items-center gap-[0.8rem]">
              <span className="font-term text-[3rem] leading-none text-amber">{e.place}</span>
              <Bot color={e.color} head={e.head} mood={mood(e.id)} size="3.6rem" delay={botDelay(e.id)} />
              <span className="host-name !text-[2.2rem]">{e.name}</span>
            </li>
          ))}
        </motion.ul>
      )}
      {stage.basis === "buzzer" && (
        <motion.p className="host-count" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.8 }}>
          <b>
            <NumberFlow value={stage.calledIt} />
          </b>{" "}
          of {stage.backing.audience} called it
        </motion.p>
      )}
    </div>
  );
}

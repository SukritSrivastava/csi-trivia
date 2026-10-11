"use client";

import { motion } from "motion/react";
import { Avatar } from "@/components/ui/Avatar";
import type { AnswerResult, HostStage, HostView, PublicPlayer } from "@/shared/protocol";
import { PromptHeader, SIDE_COLORS } from "./PromptHeader";

type Stage = Extract<HostStage, { phase: "reveal" }>;

export function RevealStage({ view, stage }: { view: HostView; stage: Stage }) {
  const byId = new Map(view.players.map((p) => [p.id, p]));
  const isDuel = stage.round.kind === "duel";
  const results = isDuel ? stage.results : [...stage.results].sort((a, b) => b.points - a.points);

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
          {results.map((r, i) => (
            <DuelResult key={r.id} result={r} side={i} author={byId.get(r.authorId)} players={byId} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-[2rem]">
          {results.map((r, i) => (
            <FinalResult key={r.id} result={r} order={i} author={byId.get(r.authorId)} />
          ))}
        </div>
      )}
    </div>
  );
}

function DuelResult({
  result,
  side,
  author,
  players,
}: {
  result: AnswerResult;
  side: number;
  author?: PublicPlayer;
  players: Map<string, PublicPlayer>;
}) {
  const lost = !result.isWinner;
  return (
    <motion.div
      className="plate relative flex min-h-[22rem] flex-col justify-between gap-[2rem] px-[3rem] py-[2.5rem]"
      style={{ background: SIDE_COLORS[side] }}
      initial={{ rotate: side === 0 ? -1.5 : 1.5, scale: 1 }}
      animate={{ scale: result.isWinner ? 1.05 : 0.95, opacity: lost ? 0.75 : 1, rotate: side === 0 ? -1.5 : 1.5 }}
      transition={{ delay: 0.9, type: "spring", stiffness: 220, damping: 16 }}
    >
      {result.sweep && (
        <motion.span
          className="type-wide absolute -top-[2rem] left-1/2 -translate-x-1/2 rotate-[-4deg] rounded-[0.8rem] bg-ink px-[1.4rem] py-[0.5rem] text-[1.8rem] font-black whitespace-nowrap text-marigold"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 1.4, type: "spring" }}
        >
          Clean sweep
        </motion.span>
      )}

      <p className="text-center text-[4rem] font-black leading-[1.1] text-balance">{result.text}</p>

      <div className="flex items-end justify-between gap-[1.5rem]">
        <motion.div
          className="flex items-center gap-[1rem]"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          {author && <Avatar name={author.name} color={author.color} size={4.5} />}
          <span className="text-[2.2rem] font-black">{author?.name ?? "Someone"}</span>
        </motion.div>

        <div className="text-right">
          <motion.p
            className="type-wide text-[4.4rem] font-black leading-none"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 1, type: "spring", stiffness: 300, damping: 14 }}
          >
            +{result.points}
          </motion.p>
          <div className="mt-[0.8rem] flex justify-end gap-[0.4rem]">
            {result.voterIds.map((id, i) => {
              const voter = players.get(id);
              return voter ? (
                <motion.span
                  key={id}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.6 + i * 0.08 }}
                >
                  <Avatar name={voter.name} color={voter.color} size={2.6} />
                </motion.span>
              ) : null;
            })}
            {result.audienceVotes > 0 && (
              <span className="self-center pl-[0.4rem] text-[1.3rem] font-bold">
                +{result.audienceVotes} audience
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function FinalResult({ result, order, author }: { result: AnswerResult; order: number; author?: PublicPlayer }) {
  return (
    <motion.div
      className={`plate flex min-h-[12rem] flex-col justify-between gap-[1rem] px-[2rem] py-[1.6rem] ${
        result.isWinner ? "bg-ink text-paper" : ""
      }`}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 * order }}
    >
      <p className="text-[2.4rem] font-black leading-tight text-balance">{result.text}</p>
      <div className="flex items-center justify-between gap-[1rem]">
        <span className="flex min-w-0 items-center gap-[0.8rem]">
          {author && <Avatar name={author.name} color={author.color} size={3} />}
          <span className="truncate text-[1.6rem] font-bold">{author?.name}</span>
        </span>
        <span className="type-wide text-[2.6rem] font-black">+{result.points}</span>
      </div>
    </motion.div>
  );
}

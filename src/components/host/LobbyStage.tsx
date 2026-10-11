"use client";

import { AnimatePresence, motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { displayUrl, textOn } from "@/lib/format";
import type { HostView } from "@/shared/protocol";
import { useJoinUrl } from "./useJoinUrl";

const TILE_TILT = [-3, 2, -1.5, 3];

/** PHASE 1 lobby. Phase 2 turns the names into a proper wall for 100 players. */
export function LobbyStage({ view }: { view: HostView }) {
  const joinUrl = useJoinUrl(view);
  const { players, roomCode } = view;

  return (
    <div className="flex w-full max-w-[120rem] flex-col gap-[3rem]">
      <div className="flex items-center justify-between gap-[4rem]">
        <div>
          <p className="text-[2.2rem] font-semibold">
            Join on your phone at <span className="font-black">{displayUrl(joinUrl)}</span>
          </p>
          <div className="mt-[2rem] flex gap-[1.5rem]" aria-label={`Room code ${roomCode.split("").join(" ")}`}>
            {roomCode.split("").map((letter, i) => (
              <motion.span
                key={`${roomCode}-${i}`}
                className="plate type-wide grid h-[13rem] w-[11rem] place-items-center text-[9rem] font-black leading-none"
                initial={{ y: -40, opacity: 0, rotate: 0 }}
                animate={{ y: 0, opacity: 1, rotate: TILE_TILT[i % TILE_TILT.length] }}
                transition={{ delay: 0.08 * i, type: "spring", stiffness: 260, damping: 18 }}
              >
                {letter}
              </motion.span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-[3rem]">
          <div className="text-center">
            <p className="type-wide text-[9rem] font-black leading-none tabular-nums">{players.length}</p>
            <p className="text-[1.8rem] font-bold">{players.length === 1 ? "player" : "players"}</p>
          </div>
          <figure className="plate flex shrink-0 flex-col items-center gap-[1rem] p-[1.6rem]">
            <QRCodeSVG
              value={`${joinUrl}?code=${roomCode}`}
              size={220}
              bgColor="#fffbf0"
              fgColor="#1b1340"
              style={{ width: "15rem", height: "15rem" }}
            />
            <figcaption className="text-[1.4rem] font-bold">Scan to join</figcaption>
          </figure>
        </div>
      </div>

      <ul className="flex max-h-[34rem] flex-wrap content-start gap-[0.8rem] overflow-hidden" aria-label="Players">
        <AnimatePresence>
          {players.map((p) => (
            <motion.li
              key={p.id}
              layout
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: p.connected ? 1 : 0.45 }}
              transition={{ type: "spring", stiffness: 400, damping: 24 }}
              className="rounded-full border-[0.2rem] border-ink px-[1.2rem] py-[0.4rem] text-[1.6rem] font-black"
              style={{ background: p.color, color: textOn(p.color) }}
            >
              {p.name}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      <p className="text-[2rem] font-bold" aria-live="polite">
        {players.length === 0 ? "Waiting for players to join." : "The organiser starts the quiz when everyone's in."}
      </p>
    </div>
  );
}

"use client";

/**
 * Lobby: the room code as 4 terminal-digit tiles, the QR code on a clock-paper
 * card with the mint offset shadow, the join link, the live count, and a wall of
 * every bot (new joiners pop in). Fits 100 without overflowing. The code and QR
 * disappear when Admin hides them.
 */
import NumberFlow from "@number-flow/react";
import { AnimatePresence, motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { useJoinUrl } from "@/components/host/useJoinUrl";
import { Bot, botDelay } from "@/components/ui/Bot";
import { displayUrl } from "@/lib/format";
import type { HostView } from "@/shared/protocol";

const TILT = [-3, 2, -1.5, 3];

/** Bot size, name size and slot width for the wall, by how many have joined. */
function wallSizing(n: number) {
  // The wall is ~108rem wide and ~35rem tall (38%–91% of the screen).
  if (n <= 24) return { bot: 5.2, name: 1.9, slot: 11 }; // ≤ 3 rows of 9
  if (n <= 50) return { bot: 4, name: 1.6, slot: 9 }; // ≤ 5 rows of 12
  if (n <= 72) return { bot: 3, name: 1.3, slot: 7 }; // ≤ 5 rows of 15
  return { bot: 2.6, name: 1.2, slot: 6 }; // 100+ in 6 rows of 18
}

export function LobbyStage({ view }: { view: HostView }) {
  const joinUrl = useJoinUrl(view);
  const n = view.cast.length;
  const size = wallSizing(n);

  return (
    <div className="absolute inset-0 z-10">
      <div className="absolute top-[5%] right-[5%] left-[5%] flex items-center justify-between gap-[4rem]">
        <div className="flex flex-col gap-[1.6rem]">
          <p className="host-hint">
            {view.roomCodeVisible ? (
              <>
                Join on your phone: <span className="text-bright">{displayUrl(joinUrl)}</span>
              </>
            ) : (
              "Everyone's in? The quiz starts soon."
            )}
          </p>
          <AnimatePresence>
            {view.roomCodeVisible && (
              <motion.div
                className="flex gap-[1.4rem]"
                aria-label={`Room code ${view.roomCode}`}
                data-testid="room-code"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                {view.roomCode.split("").map((ch, i) => (
                  <span
                    key={i}
                    className="grid h-[12.5rem] w-[10.5rem] place-items-center rounded-[1rem] border-[0.3rem] border-mint bg-void/85 font-term text-[11rem] leading-none text-mint"
                    style={{ transform: `rotate(${TILT[i % 4]}deg)` }}
                  >
                    {ch}
                  </span>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-[4rem]">
          <div className="text-center" aria-live="polite">
            <p className="font-term text-[12rem] leading-none text-amber">
              <NumberFlow value={view.counts.joined} />
            </p>
            <p className="host-hint">{view.counts.joined === 1 ? "bot in the room" : "bots in the room"}</p>
          </div>
          <AnimatePresence>
            {view.roomCodeVisible && (
              <motion.figure
                className="flex flex-col items-center gap-[0.8rem] rounded-[1rem] border-[0.5rem] border-void bg-clock p-[1.4rem] shadow-[0.72rem_0.72rem_0_var(--color-mint)]"
                initial={{ opacity: 0, scale: 0.8, rotate: 4 }}
                animate={{ opacity: 1, scale: 1, rotate: 2 }}
                exit={{ opacity: 0, scale: 0.8 }}
              >
                <QRCodeSVG value={`${joinUrl}?code=${view.roomCode}`} size={240} bgColor="#fffbf0" fgColor="#05080a" style={{ width: "15rem", height: "15rem" }} />
                <figcaption className="font-type text-[1.7rem] text-void">Scan to join</figcaption>
              </motion.figure>
            )}
          </AnimatePresence>
        </div>
      </div>

      <ul
        className="absolute top-[38%] right-[5%] bottom-[9%] left-[5%] flex flex-wrap content-start justify-center gap-y-[1rem] overflow-hidden"
        aria-label="Bots in the room"
      >
        <AnimatePresence initial={false}>
          {view.cast.map((c) => (
            <motion.li
              key={c.id}
              className="flex flex-col items-center gap-[0.4rem]"
              style={{ width: `${size.slot}rem` }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 22 }}
            >
              <Bot color={c.color} head={c.head} mood={c.mood} size={`${size.bot}rem`} delay={botDelay(c.id)} />
              <span className="host-name w-full truncate px-[0.3rem] text-center" style={{ fontSize: `${size.name}rem` }}>
                {c.name}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      <p className="host-hint absolute inset-x-0 bottom-[4%] text-center">
        {n === 0 ? "Waiting for the first bot to join." : "Build your bot on your phone. The quizmaster starts when everyone's in."}
      </p>
    </div>
  );
}

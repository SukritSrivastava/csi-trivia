"use client";

import { AnimatePresence, motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { Avatar } from "@/components/ui/Avatar";
import { displayUrl } from "@/lib/format";
import { useHostStore } from "@/stores/hostStore";
import { type HostView, MAX_PLAYERS, MIN_PLAYERS, type RoomSettings } from "@/shared/protocol";
import { useJoinUrl } from "./useJoinUrl";

const TILE_TILT = [-3, 2, -1.5, 3];

export function LobbyStage({ view }: { view: HostView }) {
  const joinUrl = useJoinUrl(view);
  const { players, roomCode } = view;
  const vip = players.find((p) => p.isVip);
  const missing = Math.max(0, MIN_PLAYERS - players.length);

  return (
    <div className="flex w-full max-w-[110rem] flex-col gap-[3.5rem]">
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

      <ul className="grid grid-cols-4 gap-[1.5rem]">
        <AnimatePresence>
          {Array.from({ length: MAX_PLAYERS }, (_, i) => {
            const p = players[i];
            if (!p) {
              return (
                <li
                  key={`empty-${i}`}
                  className="flex h-[6.5rem] items-center rounded-[1.25rem] border-[0.2rem] border-dashed border-ink/40 px-[1.5rem] text-[1.5rem] font-semibold text-ink/40"
                >
                  Open seat
                </li>
              );
            }
            return (
              <motion.li
                key={p.id}
                layout
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                className="plate flex h-[6.5rem] items-center gap-[1rem] px-[1rem]"
              >
                <Avatar name={p.name} color={p.color} size={4.2} dimmed={!p.connected} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[1.7rem] font-black">{p.name}</span>
                  <span className="block text-[1.1rem] font-semibold text-ink-soft">
                    {!p.connected ? "Reconnecting" : p.isVip ? "VIP, starts the game" : "Ready"}
                  </span>
                </span>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      <div className="flex items-end justify-between gap-[3rem]">
        <p className="text-[2rem] font-bold" aria-live="polite">
          {players.length === 0
            ? "Waiting for the first player. They'll be the VIP and start the game."
            : missing > 0
              ? `Need ${missing} more ${missing === 1 ? "player" : "players"} to start.`
              : `${vip?.name ?? "The VIP"} can start the game from their phone.`}
        </p>
        <Settings settings={view.settings} />
      </div>
    </div>
  );
}

const SETTING_LABELS: { key: keyof RoomSettings; label: string }[] = [
  { key: "extendedTimers", label: "Extra time" },
  { key: "audienceEnabled", label: "Audience" },
  { key: "hideRoomCode", label: "Hide code during game" },
];

function Settings({ settings }: { settings: RoomSettings }) {
  const update = useHostStore((s) => s.updateSettings);
  const newRoom = useHostStore((s) => s.newRoom);
  return (
    <div className="flex shrink-0 items-center gap-[0.8rem]">
      {SETTING_LABELS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          role="switch"
          aria-checked={settings[key]}
          onClick={() => update({ [key]: !settings[key] })}
          className={`rounded-full border-[0.2rem] border-ink px-[1.2rem] py-[0.5rem] text-[1.2rem] font-bold ${
            settings[key] ? "bg-ink text-paper" : "text-ink"
          }`}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        onClick={newRoom}
        className="ml-[0.6rem] text-[1.2rem] font-bold underline underline-offset-4"
      >
        New room code
      </button>
    </div>
  );
}

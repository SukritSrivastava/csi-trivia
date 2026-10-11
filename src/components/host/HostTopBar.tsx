"use client";

import { displayUrl, roundTitle } from "@/lib/format";
import { useHostStore } from "@/stores/hostStore";
import { APP_NAME, type HostView } from "@/shared/protocol";
import { useJoinUrl } from "./useJoinUrl";

/** Always on screen: who we are, which round, and how to join. */
export function HostTopBar({ view }: { view: HostView }) {
  const skip = useHostStore((s) => s.skip);
  const joinUrl = useJoinUrl(view);
  const { stage, settings, roomCode, audienceCount } = view;
  const inLobby = stage.phase === "lobby";
  const showCode = !inLobby && !settings.hideRoomCode;
  const round = "round" in stage ? stage.round : null;

  return (
    <header className="flex items-center justify-between gap-[2rem] px-[4rem] pt-[2.5rem] pb-[1rem]">
      <div className="flex items-baseline gap-[1.5rem]">
        <span className="type-wide text-[2rem] font-black tracking-tight">{APP_NAME}</span>
        {round && (
          <span className="text-[1.5rem] font-semibold text-ink-soft">
            {roundTitle(round.index, round.kind)}
            {round.multiplier > 1 && `, ${round.multiplier}× points`}
          </span>
        )}
      </div>

      <div className="flex items-center gap-[1rem]">
        {audienceCount > 0 && (
          <span className="rounded-full border-[0.2rem] border-ink px-[1rem] py-[0.3rem] text-[1.3rem] font-bold">
            {audienceCount} in the audience
          </span>
        )}
        {showCode && (
          <span className="rounded-[0.8rem] bg-ink px-[1.2rem] py-[0.5rem] text-[1.3rem] font-semibold text-paper">
            {displayUrl(joinUrl)}{" "}
            <span className="type-wide ml-[0.4rem] font-black tracking-[0.15em] text-marigold">{roomCode}</span>
          </span>
        )}
        {view.timer && (
          <button
            type="button"
            onClick={skip}
            className="rounded-[0.8rem] border-[0.2rem] border-ink px-[1rem] py-[0.4rem] text-[1.2rem] font-bold hover:bg-ink hover:text-paper"
            title="End this timer now"
          >
            Skip
          </button>
        )}
        <FullscreenButton />
      </div>
    </header>
  );
}

function FullscreenButton() {
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  };
  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-[0.8rem] border-[0.2rem] border-ink px-[1rem] py-[0.4rem] text-[1.2rem] font-bold hover:bg-ink hover:text-paper"
    >
      Full screen
    </button>
  );
}

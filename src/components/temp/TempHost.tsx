"use client";

/**
 * TEMPORARY (Phase 1) Host page, in the approved look: the projector picture
 * (TempStage) on top, test tools underneath. The real projector screens, with
 * motion and sound, replace this in Phase 4. The Host has no game controls;
 * rooms are opened from Admin.
 */
import { useEffect } from "react";
import { HostGate } from "@/components/host/HostGate";
import { useJoinUrl } from "@/components/host/useJoinUrl";
import { displayUrl } from "@/lib/format";
import type { HostView } from "@/shared/protocol";
import { useHostStore } from "@/stores/hostStore";
import { Button, Card, Countdown, RawView } from "./TempKit";
import { TempStage } from "./TempStage";

export function TempHost() {
  const connect = useHostStore((s) => s.connect);
  const view = useHostStore((s) => s.view);
  const status = useHostStore((s) => s.status);

  useEffect(() => connect(), [connect]);

  if (!view) return <HostGate />;

  return (
    <main className="min-h-dvh bg-void font-type text-ghost">
      <TempStage view={view} offline={status !== "online"} />
      <TestTools view={view} />
    </main>
  );
}

function TestTools({ view }: { view: HostView }) {
  const clockOffset = useHostStore((s) => s.clockOffset);
  const signOut = useHostStore((s) => s.signOut);
  const joinUrl = useJoinUrl(view);
  const fullJoinLink = `${joinUrl}?code=${view.roomCode}`;

  return (
    <details className="mx-auto max-w-5xl p-4 text-base">
      <summary className="cursor-pointer text-sm text-fog">Test tools (temporary)</summary>
      <div className="mt-3 flex flex-col gap-4">
        <Card>
          <p className="text-sm">
            Room <span className="font-term text-2xl text-mint">{view.roomCode}</span> · join at{" "}
            <a className="break-all text-mint-soft underline" href={fullJoinLink} target="_blank" rel="noreferrer">
              {displayUrl(fullJoinLink)}
            </a>{" "}
            · stage {view.stage.phase} · timer <Countdown timer={view.timer} clockOffset={clockOffset} paused={view.paused} />
          </p>
          <p className="mt-2 text-sm text-mint-soft">
            {view.counts.joined} joined · {view.counts.connected} connected · {view.counts.playing} playing · {view.counts.finalists} finalists ·{" "}
            {view.counts.audience} audience · sound {view.soundOn ? "on" : "off"}
          </p>
          <div className="mt-3">
            <Button onClick={signOut}>Sign out of this projector</Button>
          </div>
        </Card>
        <RawView value={view} />
      </div>
    </details>
  );
}

"use client";

/**
 * Admin: the quizmaster's control panel (Phase 2). Phone first: the step and
 * timer on top, the game in the middle, the big button at the bottom in thumb
 * reach. Controls and participants are one tap away in tabs. On a laptop: two
 * columns (game + button on the left, controls + participants on the right).
 *
 * The server computes everything (primary, hint, allowed, labels). This screen
 * only draws AdminView and sends commands with the stepId they were drawn from.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { AdminAction, AdminView } from "@/shared/protocol";
import { useAdminStore } from "@/stores/adminStore";
import { Controls } from "./Controls";
import { Dock } from "./Dock";
import { BuzzSummary, Counts, Finalists, JudgePanel, Podium, QuestionCard, UndoMark, type Send } from "./GamePanels";
import { ControlButton, Panel } from "./parts";
import { ParticipantsPanel } from "./ParticipantsPanel";
import { SignIn } from "./SignIn";
import { TopBar } from "./TopBar";
import { useShortcuts } from "./useShortcuts";

export function AdminApp() {
  const connect = useAdminStore((s) => s.connect);
  const view = useAdminStore((s) => s.view);
  useEffect(() => connect(), [connect]);
  return <div className="min-h-dvh bg-void font-type text-ghost">{view ? <Panelled view={view} /> : <SignIn />}</div>;
}

type Tab = "game" | "controls" | "people";

const WIDE = "(min-width: 1024px)";
function useWide() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

function Panelled({ view }: { view: AdminView }) {
  const storeSend = useAdminStore((s) => s.send);
  const pendingAction = useAdminStore((s) => s.pending);
  const status = useAdminStore((s) => s.status);
  const clockOffset = useAdminStore((s) => s.clockOffset);
  const signOut = useAdminStore((s) => s.signOut);
  const downloadResults = useAdminStore((s) => s.downloadResults);
  const wide = useWide();
  const [tab, setTab] = useState<Tab>("game");
  const pending = pendingAction !== null;

  // Every command carries the stepId of the view its button was drawn from.
  const stepId = view.stepId;
  const send: Send = useCallback((action: AdminAction) => void storeSend(action, stepId), [storeSend, stepId]);
  useShortcuts(view, send, pending);

  // Someone buzzed: bring the judge panel up, whatever tab is open.
  const judging = view.phase === "r2Answering";
  useEffect(() => {
    if (judging) setTab("game");
  }, [judging]);

  const game = (
    <div className="flex flex-col gap-3">
      <JudgePanel view={view} clockOffset={clockOffset} send={send} pending={pending} />
      <UndoMark view={view} send={send} pending={pending} />
      {!wide && <TimerControls view={view} send={send} pending={pending} />}
      <BuzzSummary view={view} />
      <Podium view={view} />
      {view.phase === "lobby" && <JoinInfo view={view} />}
      <Counts view={view} />
      <QuestionCard view={view} />
      <Finalists view={view} />
    </div>
  );
  const controls = <Controls view={view} send={send} pending={pending} onDownload={downloadResults} onSignOut={signOut} />;
  const people = <ParticipantsPanel view={view} send={send} />;

  return (
    <div className="flex h-dvh flex-col">
      <TopBar view={view} clockOffset={clockOffset} status={status} />
      {!wide && <Tabs tab={tab} setTab={setTab} joined={view.counts.joined} />}
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col">
          <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            {wide || tab === "game" ? game : tab === "controls" ? controls : people}
          </main>
          <Dock view={view} pending={pending} onPrimary={() => view.primary && send(view.primary.action)} onDownload={downloadResults} />
        </div>
        {wide && (
          <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain border-l border-line p-4">
            {controls}
            {people}
          </aside>
        )}
      </div>
    </div>
  );
}

function Tabs({ tab, setTab, joined }: { tab: Tab; setTab: (t: Tab) => void; joined: number }) {
  const item = (key: Tab, label: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      className="flex min-h-12 flex-1 items-center justify-center gap-1.5 border-b-2 border-transparent text-[16px] text-fog aria-selected:border-mint aria-selected:text-ghost"
      data-testid={`tab-${key}`}
    >
      {label}
    </button>
  );
  return (
    <nav className="flex border-b border-line bg-void" role="tablist">
      {item("game", "Game")}
      {item("controls", "Controls")}
      {item(
        "people",
        <>
          People <span className="font-term text-xl leading-none text-amber">{joined}</span>
        </>,
      )}
    </nav>
  );
}

/** Pause / +5s / skip, at the top of the game column while a timer runs (far from the big button). */
function TimerControls({ view, send, pending }: { view: AdminView; send: Send; pending: boolean }) {
  if (!view.timer) return null;
  const can = (t: AdminAction["type"]) => view.allowed.includes(t) && !pending;
  return (
    <div className="grid grid-cols-3 gap-2" data-testid="timer-controls">
      <ControlButton onClick={() => send({ type: view.paused ? "resume" : "pause" })} disabled={!can(view.paused ? "resume" : "pause")} testId="quick-pause">
        {view.paused ? "Resume" : "Pause"}
      </ControlButton>
      <ControlButton onClick={() => send({ type: "addTime" })} disabled={!can("addTime")} testId="quick-addTime">
        <span className="font-term text-2xl leading-none">+5s</span>
      </ControlButton>
      <ControlButton onClick={() => send({ type: "skipTimer" })} disabled={!can("skipTimer")} testId="quick-skipTimer">
        Skip timer
      </ControlButton>
    </div>
  );
}

/** Lobby: where phones join. */
function JoinInfo({ view }: { view: AdminView }) {
  return (
    <Panel title="Lobby">
      <p className="text-[15px] leading-snug text-mint-soft">
        Phones join with code <span className="font-term text-2xl leading-none tracking-[0.15em] text-mint">{view.roomCode}</span> at
      </p>
      <p className="mt-1 font-term text-xl leading-tight break-all text-ghost">{view.joinUrl}</p>
      <p className="mt-2 text-[14px] text-fog">They build their bot while they wait. Bots lock when you start the quiz.</p>
    </Panel>
  );
}

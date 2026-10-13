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
import { BlackoutPanel, Counts, CutPanel, Finalists, NextUp, notNowReason, Podium, PredictionsPanel, QuestionCard, type Send, WildCardPanel } from "./GamePanels";
import { AdminHome } from "./library/AdminHome";
import { ControlButton, Panel } from "./parts";
import { ParticipantsPanel } from "./ParticipantsPanel";
import { SignIn } from "./SignIn";
import { TopBar } from "./TopBar";
import { useShortcuts } from "./useShortcuts";

export function AdminApp() {
  const connect = useAdminStore((s) => s.connect);
  const view = useAdminStore((s) => s.view);
  const signedIn = useAdminStore((s) => s.signedIn);
  useEffect(() => connect(), [connect]);
  return (
    <div className="relative min-h-dvh bg-void font-type text-ghost">
      {/* A faint vignette (it darkens; no corridor on Admin). */}
      <div className="corridor-vignette pointer-events-none fixed inset-0 opacity-50" aria-hidden />
      <div className="relative">{view ? <Panelled view={view} /> : signedIn ? <AdminHome /> : <SignIn />}</div>
    </div>
  );
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
  const leaveRoom = useAdminStore((s) => s.leaveRoom);
  const downloadResults = useAdminStore((s) => s.downloadResults);
  const wide = useWide();
  const [tab, setTab] = useState<Tab>("game");
  const pending = pendingAction !== null;

  // Every command carries the stepId of the view its button was drawn from.
  const stepId = view.stepId;
  const send: Send = useCallback((action: AdminAction) => void storeSend(action, stepId), [storeSend, stepId]);
  useShortcuts(view, send, pending);

  const game = (
    <div className="flex flex-col gap-3">
      {!wide && !view.autopilot && <TimerControls view={view} send={send} pending={pending} />}
      <Podium view={view} />
      {view.phase === "lobby" && <JoinInfo view={view} />}
      <Counts view={view} />
      <CutPanel view={view} />
      <BlackoutPanel view={view} send={send} pending={pending} />
      <QuestionCard view={view} />
      <WildCardPanel view={view} />
      <PredictionsPanel view={view} />
      <Finalists view={view} />
      <NextUp view={view} />
    </div>
  );
  const controls = <Controls view={view} send={send} pending={pending} onDownload={downloadResults} onLeave={leaveRoom} />;
  const people = <ParticipantsPanel view={view} send={send} />;

  return (
    <div className="flex h-dvh w-full flex-col overflow-x-hidden">
      <TopBar view={view} clockOffset={clockOffset} status={status} />
      {!wide && <Tabs tab={tab} setTab={setTab} joined={view.counts.joined} />}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col">
          <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            {wide || tab === "game" ? game : tab === "controls" ? controls : people}
          </main>
          <Dock
            view={view}
            pending={pending}
            onPrimary={() => view.primary && send(view.primary.action)}
            onOptional={(o) => send(o.action)}
            onDownload={downloadResults}
          />
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
  const why = (t: AdminAction["type"]) => (can(t) ? undefined : notNowReason(t, view));
  const pause = view.paused ? "resume" : "pause";
  return (
    <div className="grid grid-cols-3 gap-2" data-testid="timer-controls">
      <ControlButton onClick={() => send({ type: pause })} disabled={!can(pause)} title={why(pause)} testId="quick-pause">
        {view.paused ? "Resume" : "Pause"}
      </ControlButton>
      <ControlButton onClick={() => send({ type: "addTime" })} disabled={!can("addTime")} title={why("addTime")} testId="quick-addTime">
        <span className="font-term text-2xl leading-none">+5s</span>
      </ControlButton>
      <ControlButton onClick={() => send({ type: "skipTimer" })} disabled={!can("skipTimer")} title={why("skipTimer")} testId="quick-skipTimer">
        Skip timer
      </ControlButton>
    </div>
  );
}

/** Lobby: where phones join. */
function JoinInfo({ view }: { view: AdminView }) {
  return (
    <Panel title="Lobby">
      <p className="mb-2 text-[17px] leading-snug text-bright" data-testid="room-quiz">
        {view.quizTitle}
      </p>
      <p className="text-[15px] leading-snug text-mint-soft">
        Phones join with code <span className="font-term text-2xl leading-none tracking-[0.15em] text-mint">{view.roomCode}</span> at
      </p>
      <p className="mt-1 font-term text-xl leading-tight break-all text-ghost">{view.joinUrl}</p>
      <p className="mt-2 text-[14px] text-fog">They build their bot while they wait. Bots lock when you start the quiz.</p>
    </Panel>
  );
}

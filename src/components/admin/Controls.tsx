"use client";

import { ACTION_LABELS } from "@/lib/adminLabels";
import type { AdminActionType, AdminView } from "@/shared/protocol";
import type { Send } from "./GamePanels";
import { ControlButton, Panel, useConfirm } from "./parts";

type Simple = "voidQuestion" | "restartQuestion" | "restartRound" | "endQuiz";

const CONFIRM_TEXT: Record<Simple, string> = {
  voidQuestion: "Tap again to void",
  restartQuestion: "Tap again to restart",
  restartRound: "Tap again: back to 0",
  endQuiz: "Tap again to end now",
};

/**
 * Everything except the big button: timers, fixes, room. One tap away, never
 * next to the primary button. Destructive ones need a second tap within 3 s.
 */
export function Controls({
  view,
  send,
  pending,
  onDownload,
  onLeave,
}: {
  view: AdminView;
  send: Send;
  pending: boolean;
  onDownload: () => void;
  /** Back to the home screen (rooms + quizzes); the room keeps running. */
  onLeave: () => void;
}) {
  const { armed, guard } = useConfirm();
  const can = (t: AdminActionType) => view.allowed.includes(t) && !pending;

  const destructive = (type: Simple) => (
    <ControlButton
      tone="danger"
      armed={armed === type}
      disabled={!can(type)}
      onClick={() => guard(type, () => send({ type }))}
      testId={`ctl-${type}`}
    >
      {armed === type ? CONFIRM_TEXT[type] : ACTION_LABELS[type]}
    </ControlButton>
  );

  return (
    <Panel title="Controls" testId="controls">
      <h3 className="mb-2 text-[14px] text-fog">Timer</h3>
      <div className="grid grid-cols-3 gap-2">
        <ControlButton
          onClick={() => send({ type: view.paused ? "resume" : "pause" })}
          disabled={!can(view.paused ? "resume" : "pause")}
          testId="ctl-pause"
        >
          {view.paused ? "Resume" : "Pause"}
        </ControlButton>
        <ControlButton onClick={() => send({ type: "addTime" })} disabled={!can("addTime")} testId="ctl-addTime">
          <span className="font-term text-2xl leading-none">+5s</span>
        </ControlButton>
        <ControlButton onClick={() => send({ type: "skipTimer" })} disabled={!can("skipTimer")} testId="ctl-skipTimer">
          Skip timer
        </ControlButton>
      </div>

      <h3 className="mt-4 mb-2 text-[14px] text-fog">Fix a mistake</h3>
      <div className="grid grid-cols-3 gap-2">
        {destructive("voidQuestion")}
        {destructive("restartQuestion")}
        {destructive("restartRound")}
      </div>

      <h3 className="mt-4 mb-2 text-[14px] text-fog">Host screen</h3>
      <div className="grid grid-cols-2 gap-2">
        <ControlButton onClick={() => send({ type: "setRoomCodeVisible", visible: !view.roomCodeVisible })} disabled={pending} testId="ctl-code">
          {view.roomCodeVisible ? "Hide room code" : "Show room code"}
        </ControlButton>
        <ControlButton onClick={() => send({ type: "setSound", on: !view.soundOn })} disabled={pending} testId="ctl-sound">
          {view.soundOn ? "Sound off" : "Sound on"}
        </ControlButton>
      </div>
      <p className="mt-1.5 text-[14px] text-fog">
        Room code {view.roomCodeVisible ? "shown" : "hidden"} · sound {view.soundOn ? "on" : "off"}
      </p>

      <h3 className="mt-4 mb-2 text-[14px] text-fog">Quiz</h3>
      <div className="grid grid-cols-3 gap-2">
        <ControlButton onClick={onDownload} testId="ctl-csv">
          Results CSV
        </ControlButton>
        {destructive("endQuiz")}
        <ControlButton onClick={onLeave} testId="ctl-leave">
          Leave room
        </ControlButton>
      </div>
    </Panel>
  );
}

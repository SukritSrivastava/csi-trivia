import type { PlayerScreen, PlayerView } from "@/shared/protocol";

type Screen = Extract<PlayerScreen, { kind: "wait" }>;

/** "Look at the TV" moments. Short, calm, nothing to tap. */
export function WaitScreen({ screen }: { screen: Screen; view: PlayerView }) {
  return (
    <div className="flex flex-1 flex-col justify-center text-center" aria-live="polite">
      <p className="type-wide text-3xl font-black leading-tight text-balance">{screen.title}</p>
      {screen.detail && <p className="mt-3 text-lg text-paper/75">{screen.detail}</p>}
    </div>
  );
}

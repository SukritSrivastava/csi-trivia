"use client";

import { memo, useDeferredValue, useMemo, useState } from "react";
import { Bot, botDelay } from "@/components/ui/Bot";
import type { AdminParticipant, AdminView } from "@/shared/protocol";
import type { Send } from "./GamePanels";
import { Dot, Panel, useConfirm } from "./parts";

type Filter = "all" | "playing" | "audience" | "finalist" | "wildcard" | "left" | "offline";

const FILTERS: { key: Filter; label: string; test: (p: AdminParticipant) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "playing", label: "Playing", test: (p) => p.status === "playing" },
  { key: "audience", label: "Audience", test: (p) => p.status === "audience" },
  { key: "finalist", label: "Finalists", test: (p) => p.status === "finalist" },
  { key: "wildcard", label: "Wild card", test: (p) => p.status === "wildcard" },
  { key: "left", label: "Left page", test: (p) => p.status !== "removed" && (p.leftPageCount > 0 || p.pageHidden) },
  { key: "offline", label: "Offline", test: (p) => p.status !== "removed" && !p.connected },
];

const STATUS_TEXT: Record<AdminParticipant["status"], string> = {
  playing: "playing",
  finalist: "finalist",
  wildcard: "wild card",
  audience: "audience",
  removed: "removed",
};

/**
 * Everyone who joined: search, filter, live status, remove (second tap to
 * confirm). Fast with 100 names: rows are memoised, off-screen rows skip
 * rendering (content-visibility), and the small bots sit still.
 */
export function ParticipantsPanel({ view, send }: { view: AdminView; send: Send }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const deferredQuery = useDeferredValue(query);
  const { armed, guard } = useConfirm();
  const canRemove = view.allowed.includes("removeParticipant");
  const showPoints = view.finalists.length > 0;

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, view.participants.filter(f.test).length])) as Record<Filter, number>, [view.participants]);

  const rows = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const test = FILTERS.find((f) => f.key === filter)!.test;
    return view.participants.filter((p) => test(p) && (!q || p.name.toLowerCase().includes(q)));
  }, [view.participants, deferredQuery, filter]);

  return (
    <Panel title="Participants" aside={<span className="font-term text-2xl leading-none text-amber">{view.counts.joined}</span>} testId="participants">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name"
        aria-label="Search participants by name"
        className="w-full rounded-[0.9rem] border-2 border-line bg-void px-4 py-3 text-[16px] text-ghost outline-none placeholder:text-fog focus:border-mint"
        data-testid="participant-search"
      />
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border-2 border-line px-3.5 text-[14px] text-mint-soft aria-pressed:border-mint aria-pressed:bg-mint/[0.1] aria-pressed:text-ghost"
            data-testid={`filter-${f.key}`}
          >
            {f.label}
            <span className="font-term text-lg leading-none text-amber">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      <ul className="mt-2 divide-y divide-line [&_*]:animate-none!" data-testid="participant-list">
        {rows.map((p) => (
          <Row
            key={p.id}
            p={p}
            showPoints={showPoints}
            armed={armed === p.id}
            canRemove={canRemove && p.status !== "removed"}
            onRemove={() => guard(p.id, () => send({ type: "removeParticipant", participantId: p.id }))}
          />
        ))}
      </ul>
      {rows.length === 0 && <p className="py-6 text-center text-[15px] text-fog">Nobody matches.</p>}
    </Panel>
  );
}

const Row = memo(
  function Row({ p, showPoints, armed, canRemove, onRemove }: { p: AdminParticipant; showPoints: boolean; armed: boolean; canRemove: boolean; onRemove: () => void }) {
    const removed = p.status === "removed";
    return (
      <li className={`flex min-h-15 items-center gap-3 py-2 [contain-intrinsic-size:auto_60px] [content-visibility:auto] ${removed ? "opacity-45" : ""}`} data-testid="participant-row">
        <Bot color={p.color} head={p.head} mood={removed ? "out" : "idle"} size="30px" delay={botDelay(p.id)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] leading-tight text-ghost">{p.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[14px] leading-tight text-fog">
            <Dot on={p.connected && !removed} label={p.connected ? "online" : "offline"} />
            <span className={p.status === "finalist" ? "text-mint" : ""}>{STATUS_TEXT[p.status]}</span>
            {p.joinedLate && <span>late</span>}
            {!p.connected && !removed && <span className="text-wrong">offline</span>}
            {p.pageHidden && !removed && <span className="text-wrong">away now</span>}
            {p.leftPageCount > 0 && <span className="text-wrong">left page ×{p.leftPageCount}</span>}
            {p.answered !== null && <span className={p.answered ? "text-mint" : ""}>{p.answered ? "answered" : "not yet"}</span>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-term text-2xl leading-none text-ghost tabular-nums">{p.score}</p>
          <p className="text-[14px] leading-tight text-fog">
            {p.rank != null ? `#${p.rank}` : " "}
            {showPoints && p.wildCorrect !== null ? <span className="text-amber"> · {p.wildCorrect} right</span> : null}
            {showPoints && p.blackout ? <span className="text-amber"> · {p.blackout.place ? `out #${p.blackout.place}` : `+${p.blackout.gap}`}</span> : null}
          </p>
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className={`min-h-11 w-[5.5rem] shrink-0 rounded-[0.9rem] border-2 border-wrong px-2 text-[14px] leading-tight ${armed ? "bg-wrong text-void" : "bg-wrong/[0.07] text-wrong"}`}
            aria-label={armed ? `Tap again to remove ${p.name}` : `Remove ${p.name}`}
            data-testid="remove"
          >
            {armed ? "Tap again" : "Remove"}
          </button>
        )}
      </li>
    );
  },
  (a, b) =>
    a.armed === b.armed &&
    a.canRemove === b.canRemove &&
    a.showPoints === b.showPoints &&
    a.p.name === b.p.name &&
    a.p.color === b.p.color &&
    a.p.head === b.p.head &&
    a.p.status === b.p.status &&
    a.p.connected === b.p.connected &&
    a.p.pageHidden === b.p.pageHidden &&
    a.p.leftPageCount === b.p.leftPageCount &&
    a.p.score === b.p.score &&
    a.p.rank === b.p.rank &&
    a.p.wildCorrect === b.p.wildCorrect &&
    a.p.blackout?.gap === b.p.blackout?.gap &&
    a.p.blackout?.place === b.p.blackout?.place &&
    a.p.answered === b.p.answered &&
    a.p.joinedLate === b.p.joinedLate,
);

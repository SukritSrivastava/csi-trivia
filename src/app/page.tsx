import Link from "next/link";
import { Bot } from "@/components/ui/Bot";
import { Corridor } from "@/components/ui/Corridor";
import { APP_NAME, BOT_HEADS, PARTICIPANT_COLORS } from "@/shared/protocol";

/** A few sample bots on the front door, one of each head. */
const CREW = BOT_HEADS.map((head, i) => ({ head, color: PARTICIPANT_COLORS[(i * 5) % PARTICIPANT_COLORS.length] }));

export default function Home() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-12 text-center">
      <Corridor scrim="full" />

      <div className="relative z-10 flex max-w-3xl flex-col items-center gap-8">
        <ul className="flex flex-wrap justify-center gap-4 sm:gap-6" aria-hidden>
          {CREW.map((b, i) => (
            <li key={b.head}>
              <Bot color={b.color} head={b.head} size="clamp(34px, 7vw, 56px)" delay={i * 0.45} />
            </li>
          ))}
        </ul>

        <div className="flex flex-col items-center gap-4">
          <h1 className="font-term text-7xl leading-none text-mint sm:text-9xl">
            {APP_NAME.toUpperCase()}
          </h1>
          <p className="max-w-xl -rotate-2 text-lg text-bright sm:text-2xl">
            Questions on the projector. Answers on your phone. Six bots make it to the buzzer round.
          </p>
        </div>

        <nav className="flex w-full max-w-xl flex-col gap-3 sm:flex-row">
          <Link href="/play" className="phone-go flex-1">
            JOIN THE QUIZ
          </Link>
          <Link href="/host" className="phone-opt flex-1 justify-center">
            Host screen
          </Link>
          <Link href="/admin" className="phone-opt flex-1 justify-center">
            Admin
          </Link>
        </nav>

        <a href="/finaldesign.html" className="text-sm text-fog underline underline-offset-4 hover:text-mint-soft">
          Design reference
        </a>
      </div>
    </main>
  );
}

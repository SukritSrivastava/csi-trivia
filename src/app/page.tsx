import Link from "next/link";
import { APP_NAME } from "@/shared/protocol";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col justify-center gap-10 bg-marigold px-6 py-12 text-ink sm:px-16">
      <div className="max-w-3xl">
        <h1 className="type-wide text-6xl font-black leading-none tracking-tight sm:text-8xl">{APP_NAME}</h1>
        <p className="mt-5 max-w-xl text-xl font-medium text-ink-soft sm:text-2xl">
          Questions on the projector. Answers on your phone. The fastest six go to the buzzer round.
        </p>
      </div>

      <div className="flex max-w-3xl flex-col gap-4 sm:flex-row">
        <Link href="/play" className="press bg-ink px-7 py-5 text-center text-xl font-bold text-paper">
          Join the quiz
        </Link>
        <Link href="/host" className="press bg-paper px-7 py-5 text-center text-xl font-bold text-ink">
          Host screen
        </Link>
        <Link href="/admin" className="press bg-paper px-7 py-5 text-center text-xl font-bold text-ink">
          Admin
        </Link>
      </div>
    </main>
  );
}

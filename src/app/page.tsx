import Link from "next/link";
import { APP_NAME } from "@/shared/protocol";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col justify-center gap-10 bg-marigold px-6 py-12 text-ink sm:px-16">
      <div className="max-w-3xl">
        <h1 className="type-wide text-6xl font-black leading-none tracking-tight sm:text-8xl">
          {APP_NAME}
        </h1>
        <p className="mt-5 max-w-xl text-xl font-medium text-ink-soft sm:text-2xl">
          One screen everyone can see. Everyone plays on their phone.
        </p>
      </div>

      <div className="flex max-w-3xl flex-col gap-4 sm:flex-row">
        <Link
          href="/host"
          className="press bg-ink px-7 py-5 text-center text-xl font-bold text-paper"
        >
          Host on this screen
        </Link>
        <Link
          href="/play"
          className="press bg-paper px-7 py-5 text-center text-xl font-bold text-ink"
        >
          Join with a code
        </Link>
      </div>

      <p className="max-w-xl text-base text-ink-soft">
        Open this site on a laptop or TV to host. Players join from their phones on the same Wi-Fi.
      </p>
    </main>
  );
}

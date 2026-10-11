# server/ (backend teammate)

The real game server goes here. Build it against `src/shared/protocol.ts`.

Until it's ready, `mock-server/` runs the whole quiz so the frontend can be
built and tested on its own. It implements every event and view in the
protocol, so it's a working reference for the rules in `docs/SPEC.md`.

When the real server is ready, point `npm run dev:game` in `package.json` at it.

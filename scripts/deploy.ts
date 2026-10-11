/**
 * npm run deploy: puts what's on `main` live.
 *   1. checks you're on main, clean and pushed (Render builds from GitHub, not from this folder)
 *   2. Render: starts a deploy of the game server, waits until it's live, checks /health
 *   3. Vercel: builds and deploys the website from this folder (production)
 *
 * Needs in .env.local (git-ignored; see docs/DEPLOY.md):
 *   RENDER_API_KEY, RENDER_SERVICE_ID, VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID
 * Options: --skip-render, --skip-vercel, --allow-dirty
 */
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // fall back to the real environment
}

const flag = (name: string) => process.argv.includes(`--${name}`);
const need = (key: string) => {
  const v = process.env[key];
  if (!v) {
    console.error(`\n  Missing ${key} in .env.local (see docs/DEPLOY.md, "Updating it").\n`);
    process.exit(1);
  }
  return v;
};
const sh = (cmd: string) => execSync(cmd, { encoding: "utf8" }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function render() {
  const key = need("RENDER_API_KEY");
  const service = need("RENDER_SERVICE_ID");
  const api = (path: string, init?: RequestInit) =>
    fetch(`https://api.render.com/v1/services/${service}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
    }).then(async (r) => {
      if (!r.ok) throw new Error(`Render ${path}: ${r.status} ${await r.text()}`);
      return r.json();
    });

  const info = await api("");
  const url: string = info.serviceDetails.url;
  const deploy = await api("/deploys", { method: "POST", body: "{}" });
  console.log(`Render: deploying ${info.name} (${deploy.id})…`);
  const done = ["live", "build_failed", "update_failed", "canceled", "deactivated"];
  let status = deploy.status as string;
  for (let i = 0; i < 90 && !done.includes(status); i++) {
    await sleep(10_000);
    status = (await api(`/deploys/${deploy.id}`)).status;
    process.stdout.write(`  ${status}\r`);
  }
  if (status !== "live") throw new Error(`Render deploy ended as "${status}". Check the Render dashboard log.`);
  const health = await fetch(`${url}/health`).then((r) => r.text());
  if (health !== "ok") throw new Error(`${url}/health said "${health}"`);
  console.log(`Render: live at ${url} (/health ok)`);
}

function vercel() {
  const token = need("VERCEL_TOKEN");
  // The CLI reads the project link from .vercel/project.json (git-ignored), so write it.
  mkdirSync(".vercel", { recursive: true });
  writeFileSync(".vercel/project.json", JSON.stringify({ projectId: need("VERCEL_PROJECT_ID"), orgId: need("VERCEL_ORG_ID") }));
  console.log("Vercel: building and deploying the website…");
  const run = spawnSync("npx", ["--yes", "vercel@latest", "deploy", "--prod", "--yes", "--token", token], {
    stdio: ["ignore", "pipe", "inherit"],
    shell: true,
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error("Vercel deploy failed (see above).");
  console.log(`Vercel: deployed ${run.stdout.trim().split(/\s+/).find((w) => w.startsWith("https://")) ?? ""}`);
}

async function main() {
  if (!flag("allow-dirty")) {
    const branch = sh("git rev-parse --abbrev-ref HEAD");
    if (branch !== "main") throw new Error(`You're on "${branch}". Deploy from main (git checkout main).`);
    if (sh("git status --porcelain")) throw new Error("Uncommitted changes. Commit (or stash) first, or pass --allow-dirty.");
    sh("git fetch origin main");
    if (sh("git rev-parse HEAD") !== sh("git rev-parse origin/main")) throw new Error("main isn't pushed (or is behind origin/main). git push / git pull first.");
  }
  if (!flag("skip-render")) await render();
  if (!flag("skip-vercel")) vercel();
  console.log("\nDone. Host: https://hermes-quiz-nine.vercel.app/host   Admin: /admin");
}

main().catch((e) => {
  console.error(`\n  ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});

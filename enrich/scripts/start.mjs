// Production entry point (`pnpm start`). One repo deploys as two services, picked by name:
// SERVICE, or Railway's RAILWAY_SERVICE_NAME, must be "web" or "worker".
import { spawn, spawnSync } from "node:child_process";

const service = (process.env.SERVICE ?? process.env.RAILWAY_SERVICE_NAME ?? "").trim().toLowerCase();

const steps = {
  // Migrate and seed are idempotent, so they run on every web start.
  web: ["pnpm db:migrate", "pnpm db:seed", "pnpm --filter @enrich/web start"],
  worker: ["pnpm --filter @enrich/worker start"],
}[service];

if (!steps) {
  console.error(`Unknown service "${service}". Name the service "web" or "worker", or set SERVICE=web|worker.`);
  process.exit(1);
}

const server = steps.pop();
for (const command of steps) {
  console.log(`> ${command}`);
  const { status } = spawnSync(command, { stdio: "inherit", shell: true });
  if (status !== 0) process.exit(status ?? 1);
}

// Pass stop signals on so the worker can finish its job and shut down cleanly.
console.log(`> ${server}`);
const child = spawn(server, { stdio: "inherit", shell: true });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));

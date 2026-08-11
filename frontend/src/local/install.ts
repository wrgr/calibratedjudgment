// One-time wiring for the static build. Called from main.tsx when VITE_STATIC=1
// (dynamically imported, so the normal backend build never pulls the local
// backend in). Replaces the global EventSource with the job-manager-backed shim;
// the api client routes /api calls to ./backend on its own (see api/client.ts).

import { StaticEventSource } from './eventsource';

export function installStaticBackend(): void {
  (globalThis as unknown as { EventSource: unknown }).EventSource = StaticEventSource;
}

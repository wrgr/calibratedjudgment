// Minimal EventSource stand-in for the static build. The real app opens
// `new EventSource('/api/jobs/{id}/events')` to stream grading progress; there
// is no server to stream from, so in static mode window.EventSource is replaced
// with this class, which drives the same {type:progress|done|error} frames off
// the in-browser job manager (./jobs.ts). Only the members SessionDetail uses
// (onmessage, onerror, close) are implemented.

import { subscribe } from './jobs';

export class StaticEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onopen: ((ev?: unknown) => void) | null = null;
  readyState = StaticEventSource.CONNECTING;

  private unsub: (() => void) | null = null;
  private closed = false;

  constructor(url: string) {
    const m = /\/api\/jobs\/([^/]+)\/events/.exec(url);
    // Defer so the caller can attach onmessage/onerror before the first frame.
    setTimeout(() => {
      if (this.closed) return;
      if (!m) {
        this.readyState = StaticEventSource.CLOSED;
        this.onerror?.();
        return;
      }
      this.readyState = StaticEventSource.OPEN;
      this.onopen?.();
      this.unsub = subscribe(m[1], (ev) => {
        this.onmessage?.({ data: JSON.stringify(ev) });
      });
    }, 0);
  }

  close(): void {
    this.closed = true;
    this.readyState = StaticEventSource.CLOSED;
    this.unsub?.();
    this.unsub = null;
  }

  // No-op listener API for any code that prefers addEventListener.
  addEventListener(): void {}
  removeEventListener(): void {}
}

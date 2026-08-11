// In-browser grading-job manager — the static-build counterpart of
// backend/app/services/jobs.py. A job's work() runs as an async task in the
// page; progress is held in memory and streamed to subscribers (the EventSource
// shim in ./eventsource.ts) with GET /api/jobs/{id} as the polling fallback,
// exactly as the real backend exposes it.

export type JobEvent =
  | { type: 'progress'; done: number; total: number; label: string }
  | { type: 'done' }
  | { type: 'error'; error: string };

export interface Job {
  id: string;
  assessmentId: string;
  status: 'running' | 'done' | 'error';
  done: number;
  total: number;
  label: string;
  error: string;
}

type Listener = (ev: JobEvent) => void;

const jobs = new Map<string, Job>();
const listeners = new Map<string, Set<Listener>>();

function emit(id: string, ev: JobEvent): void {
  for (const l of listeners.get(id) ?? []) l(ev);
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/** Subscribe to a job's events. Immediately replays current state (progress +
 *  any terminal event), then streams live events. Returns an unsubscribe fn. */
export function subscribe(id: string, cb: Listener): () => void {
  const set = listeners.get(id) ?? new Set<Listener>();
  set.add(cb);
  listeners.set(id, set);

  const job = jobs.get(id);
  if (job) {
    cb({ type: 'progress', done: job.done, total: job.total, label: job.label });
    if (job.status === 'done') cb({ type: 'done' });
    else if (job.status === 'error') cb({ type: 'error', error: job.error });
  } else {
    cb({ type: 'error', error: 'unknown job' });
  }

  return () => {
    const s = listeners.get(id);
    if (s) {
      s.delete(cb);
      if (!s.size) listeners.delete(id);
    }
  };
}

export function startJob(
  assessmentId: string,
  total: number,
  work: (report: (done: number, total: number, label: string) => void) => Promise<void>,
): string {
  const id = 'job_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
  const job: Job = { id, assessmentId, status: 'running', done: 0, total, label: '', error: '' };
  jobs.set(id, job);

  const report = (done: number, t: number, label: string) => {
    job.done = done;
    job.total = t;
    job.label = label;
    emit(id, { type: 'progress', done, total: t, label });
  };

  // Run detached — startJob returns the id immediately, like the server thread.
  void (async () => {
    try {
      await work(report);
      job.status = 'done';
      emit(id, { type: 'done' });
    } catch (e) {
      job.status = 'error';
      job.error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      emit(id, { type: 'error', error: job.error });
    }
  })();

  return id;
}

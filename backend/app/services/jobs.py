"""In-process grading-job manager.

A job runs in a daemon thread; progress is persisted to the jobs table (the
polling fallback) and mirrored to an in-memory queue per job for SSE. The DB
row is authoritative — a dropped SSE connection can always resume from
GET /api/jobs/{id}.
"""

import json
import queue
import threading

from ..db import database as db

_queues: dict[str, "queue.Queue[dict | None]"] = {}
_lock = threading.Lock()


def _queue_for(job_id: str):
    with _lock:
        return _queues.setdefault(job_id, queue.Queue())


def _emit(job_id: str, event: dict):
    _queue_for(job_id).put(event)


def _finish(job_id: str):
    _queue_for(job_id).put(None)
    with _lock:
        # Leave the queue for any attached listener to drain; a fresh listener
        # replays state from the DB row instead.
        _queues.pop(job_id, None)


def start_job(assessment_id: str, kind: str, total: int, work) -> str:
    """Run work(report) in a thread. `report(done, total, label)` streams progress;
    events also flow to SSE listeners. Returns the job id immediately."""
    job_id = db.create_job(assessment_id, kind, total)

    def report(done: int, total_: int, label: str):
        db.update_job(job_id, done=done, total=total_, label=label)
        _emit(job_id, {"type": "progress", "done": done, "total": total_, "label": label})

    def run():
        try:
            work(report)
            db.update_job(job_id, status="done")
            _emit(job_id, {"type": "done"})
        except Exception as e:  # surfaced to the client; full trace in server logs
            import logging
            logging.getLogger(__name__).exception("job %s failed", job_id)
            db.update_job(job_id, status="error", error=str(e)[:500])
            _emit(job_id, {"type": "error", "error": str(e)[:500]})
        finally:
            _finish(job_id)

    threading.Thread(target=run, daemon=True).start()
    return job_id


def sse_events(job_id: str):
    """Generator of SSE frames for a job. Replays current DB state first, then
    live events until the job finishes (or the row says it already did)."""
    job = db.get_job(job_id)
    if not job:
        yield f"data: {json.dumps({'type': 'error', 'error': 'unknown job'})}\n\n"
        return
    yield ("data: " + json.dumps({
        "type": "progress", "done": job["done"], "total": job["total"],
        "label": job["label"],
    }) + "\n\n")
    if job["status"] != "running":
        final = {"type": "done"} if job["status"] == "done" else {
            "type": "error", "error": job["error"]}
        yield f"data: {json.dumps(final)}\n\n"
        return

    q = _queue_for(job_id)
    while True:
        try:
            event = q.get(timeout=30)
        except queue.Empty:
            # keep-alive; also re-check the DB in case the worker died silently
            job = db.get_job(job_id)
            if job and job["status"] != "running":
                final = {"type": "done"} if job["status"] == "done" else {
                    "type": "error", "error": job["error"]}
                yield f"data: {json.dumps(final)}\n\n"
                return
            yield ": keep-alive\n\n"
            continue
        if event is None:
            return
        yield f"data: {json.dumps(event)}\n\n"

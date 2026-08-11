#!/usr/bin/env python3
"""Generate the static-demo fixtures the browser build ships with.

The GitHub Pages build has no Python backend, so the four bundled exemplar
sessions are pre-expanded here — through the SAME aggregation/divergence code
the live engine uses — and written as a single JSON blob the client seeds its
in-browser store from. Regenerate with `make gen-demo` (or run this directly)
whenever content/exemplars/, the rubric, or the seed users change.

No database, no network, no LLM: pure functions only, so this runs anywhere the
repo is checked out.
"""

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

from app.services.grading import divergence as div  # noqa: E402
from app.services.grading import exemplars as ex  # noqa: E402
from app.core import llm as core_llm  # noqa: E402
from app import config  # noqa: E402

OUT = REPO / "frontend" / "src" / "local" / "fixtures" / "demo.json"

# Stable timestamp so regenerating without content changes yields no diff.
FIXED_TS = "2026-01-01T00:00:00Z"

# Mirror seed_content._EXEMPLAR_OWNERS / database._SEED_USERS so the demo store
# matches what a freshly-seeded backend would show.
EXEMPLAR_OWNERS = {
    "exemplar-maya": "emma",
    "exemplar-jordan": "liam",
    "exemplar-sam": "sofia",
    "exemplar-alex": "james",
}

SEED_USERS = [
    ("admin", "admin", "Administrator"),
    ("instructor", "instructor", "Instructor Demo"),
    ("emma", "student", "Emma Clarke"),
    ("liam", "student", "Liam Patel"),
    ("sofia", "student", "Sofia Nguyen"),
    ("james", "student", "James Okafor"),
    ("priya", "student", "Priya Singh"),
    ("tyler", "student", "Tyler Brooke"),
]


def score_record_out(rec: dict) -> dict:
    """camelCase serialisation matching api/sessions.py::_score_record_out."""
    return {
        "criterionId": rec["criterion_id"],
        "channel": rec["channel"],
        "passes": rec["passes"],
        "median": rec["median"],
        "spread": rec["spread"],
        "noEvidence": rec["no_evidence"],
        "confidence": rec["confidence"],
        "evidence": rec["evidence"],
        "anchorMatched": rec.get("anchor_matched") or None,
        "styleApplied": rec.get("style_applied") or None,
        "styleNote": rec.get("style_note") or None,
        "styleIntensity": rec.get("style_intensity") or None,
        "rubricVersion": rec["rubric_version"],
        "gradedAt": rec["graded_at"],
        "needsReview": rec["needs_review"],
        "reviewReasons": rec["review_reasons"],
        "teacherOverride": None,
    }


def build_providers() -> dict:
    """Provider list mirroring api/content.py::providers, but with no server
    keys (configured is always False in the BYO-only static build) and no
    network calls — curated model lists only."""
    out = []
    for name, cfg in config.PROVIDERS.items():
        models = core_llm._PROVIDER_MODELS.get(name, [])
        if name == "Ollama":
            # Local model hosting is future work; the browser can't enumerate a
            # local Ollama at build time. Offer the default so it's selectable.
            models = [cfg["model"]]
        out.append({
            "name": name,
            "defaultModel": cfg["model"],
            "models": models,
            "configured": False,
            # base_url is needed for the browser to call the provider directly
            # in the BYO-key static build (there is no server to dispatch through).
            "baseUrl": cfg["base_url"],
        })
    return {"providers": out, "default": config.DEFAULT_PROVIDER}


def main() -> None:
    rubric_path = REPO / "content" / "rubrics" / "mccr-w11-12-arg-v1.json"
    rubric = json.loads(rubric_path.read_text())
    rubric_version = rubric.get("version", "1.0")

    assessments = []
    for definition in ex.load_exemplar_defs():
        expanded = ex.expand_exemplar(definition, rubric)
        owner = EXEMPLAR_OWNERS.get(definition["id"], "emma")
        records = expanded["scores"]
        for rec in records:
            rec["graded_at"] = FIXED_TS
        dims = div.compute_divergence(rubric, records)
        assessments.append({
            "id": definition["id"],
            "username": owner,
            "mode": "essay_trace",
            "status": "graded",
            "name": expanded["name"],
            "description": expanded["description"],
            "contentId": "mccr-w11-12-arg",
            "contentVersion": rubric_version,
            "isExemplar": True,
            "gradedLive": False,
            "createdAt": FIXED_TS,
            "completedAt": FIXED_TS,
            "artifacts": {"essay": expanded["essay"], "trace": expanded["trace"]},
            "scores": [score_record_out(r) for r in records],
            "layerB": expanded["layer_b"],
            "divergence": dims,
            "interpretation": div.interpret_divergence(dims, expanded["layer_b"]),
        })

    users = [
        {"username": u, "role": r, "displayName": n, "createdAt": FIXED_TS}
        for u, r, n in SEED_USERS
    ]

    rubric_item = {
        "contentId": rubric.get("rubricId", "mccr-w11-12-arg"),
        "version": rubric_version,
        "createdBy": "seed",
        "createdAt": FIXED_TS,
        "payload": rubric,
    }

    blob = {
        "generatedBy": "scripts/gen_demo_fixtures.py",
        "rubricVersion": rubric_version,
        "users": users,
        "rubric": rubric_item,
        "providers": build_providers(),
        "assessments": assessments,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(blob, indent=2, ensure_ascii=False) + "\n")
    print(f"[gen-demo] wrote {OUT.relative_to(REPO)} "
          f"({len(assessments)} sessions, {len(users)} users)")


if __name__ == "__main__":
    main()

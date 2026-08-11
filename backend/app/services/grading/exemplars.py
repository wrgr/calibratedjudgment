"""Bundled exemplar sessions — port of TGFWA src/data/expand.ts.

The exemplar definitions (content/exemplars/exemplar-defs.json) were exported
verbatim from TGFWA's TypeScript sources. Each compact ScoreSeed is expanded
through the SAME aggregation code the live grading engine uses, so demo data
and live data are structurally identical — and the expansion doubles as a
cross-language check on the aggregate port (tests/test_exemplars.py).
"""

import json
from pathlib import Path

from .aggregate import aggregate_passes
from .layerb import summarize_segments

EXEMPLAR_FILE = (Path(__file__).resolve().parents[4]
                 / "content" / "exemplars" / "exemplar-defs.json")


def load_exemplar_defs() -> list:
    return json.loads(EXEMPLAR_FILE.read_text())


def seed_to_record(seed: dict, rubric: dict) -> dict:
    criterion = next((c for c in rubric["criteria"]
                      if c["criterionId"] == seed["criterionId"]), None)
    passes = [
        {
            "score": score,
            "selfConfidence": "med",
            "evidence": seed.get("evidence", []) if isinstance(score, (int, float)) else [],
            "anchorMatched": seed.get("anchorMatched"),
        }
        for score in seed["passes"]
    ]
    return aggregate_passes(
        criterion_id=seed["criterionId"],
        channel=seed["channel"],
        referenceability=(criterion or {}).get("referenceability", "strong"),
        passes=passes,
        rubric_version=rubric.get("version", ""),
    )


def expand_exemplar(definition: dict, rubric: dict) -> dict:
    """Returns {assessment fields..., scores: [...], layer_b: {...}}."""
    return {
        "id": definition["id"],
        "name": definition["name"],
        "description": definition["description"],
        "trace": definition["trace"],
        "essay": definition["essay"],
        "scores": [seed_to_record(s, rubric) for s in definition["scoreSeeds"]],
        "layer_b": summarize_segments(definition["layerBSegments"]),
        "rubric_version": rubric.get("version", ""),
    }

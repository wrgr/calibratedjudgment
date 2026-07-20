"""Seed the content_items table from the content/ corpus (idempotent).

Rubrics keep the version stamped inside their JSON. Seeding never overwrites
an existing (kind, content_id, version) row, so local edits made through the
app survive re-seeding.
"""

import json
from pathlib import Path

from . import database as db

CONTENT_DIR = Path(__file__).resolve().parents[3] / "content"


def _seed_item(kind: str, content_id: str, version: str, payload: dict, verbose: bool):
    if db.get_content(kind, content_id, version):
        return False
    db.upsert_content(kind, content_id, version, payload, created_by="seed")
    if verbose:
        print(f"[seed] {kind}: {content_id} v{version}")
    return True


def seed(verbose: bool = True) -> int:
    db.init_db()
    n = 0
    for path in sorted((CONTENT_DIR / "rubrics").glob("*.json")):
        payload = json.loads(path.read_text())
        n += _seed_item("rubric", payload.get("rubricId", path.stem),
                        payload.get("version", "1.0"), payload, verbose)
    n += seed_exemplars(verbose)
    if verbose and n == 0:
        print("[seed] Content already present; skipped.")
    return n


# TGFWA's four synthetic exemplar sessions (one per divergence pattern,
# including the adversarial parrot), assigned to demo students so the
# cold-start demo needs zero setup and no API key.
_EXEMPLAR_OWNERS = {
    "exemplar-maya": "emma",
    "exemplar-jordan": "liam",
    "exemplar-sam": "sofia",
    "exemplar-alex": "james",
}


def seed_exemplars(verbose: bool = True) -> int:
    from ..services.grading import exemplars as ex

    rubric_item = db.get_content("rubric", "mccr-w11-12-arg")
    if not rubric_item:
        return 0
    rubric = rubric_item["payload"]
    n = 0
    for definition in ex.load_exemplar_defs():
        if db.get_assessment(definition["id"]):
            continue
        expanded = ex.expand_exemplar(definition, rubric)
        db.create_assessment(
            username=_EXEMPLAR_OWNERS.get(definition["id"], "emma"),
            mode="essay_trace",
            name=expanded["name"],
            description=expanded["description"],
            content_id="mccr-w11-12-arg",
            content_version=rubric_item["version"],
            artifacts={"essay": expanded["essay"], "trace": expanded["trace"]},
            is_exemplar=True,
            status="graded",
            assessment_id=definition["id"],
        )
        for rec in expanded["scores"]:
            db.upsert_score_record(definition["id"], rec)
        db.upsert_layer_b(definition["id"], expanded["layer_b"])
        if verbose:
            print(f"[seed] exemplar: {definition['id']}")
        n += 1
    return n

"""Idempotent seeding: demo users + the content corpus from content/.

Run as `python -m app.db.seed` (or `make seed` from the repo root).
Content seeding is added by the content pipeline; user seeding lives in
database.seed_default_users so app startup can also guarantee accounts exist.
"""

from . import database as db


def seed_all(verbose: bool = True):
    created = db.seed_default_users()
    if verbose:
        if created:
            print("[seed] Created demo accounts:")
            print("  admin:      admin / admin123")
            print("  instructor: instructor / Teach@2024")
            print("  students:   emma liam sofia james priya tyler / Learn@2024")
        else:
            print("[seed] Users already present; skipped.")
    try:
        from . import seed_content
        seed_content.seed(verbose=verbose)
    except ImportError:
        pass  # content pipeline not installed yet (pre-M2)


if __name__ == "__main__":
    seed_all()

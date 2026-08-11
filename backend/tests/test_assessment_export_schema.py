"""Export schema v3 for the essay+trace grading platform.

Guards: the schema version is traceable, and every export column is
documented in the data dictionary (tests enforce the two move together).
"""

import unittest
from pathlib import Path

from app.api.export import EXPORT_FIELDS
from app.db import database

REPO_ROOT = Path(__file__).resolve().parents[2]


class ExportDictionaryTests(unittest.TestCase):
    DOC = (REPO_ROOT / "docs" / "research_export_data_dictionary.md").read_text(encoding="utf-8")

    def test_schema_version_is_3(self):
        self.assertEqual(database.EXPORT_SCHEMA_VERSION, "3")
        self.assertIn("v3", self.DOC)

    def test_every_export_column_is_documented(self):
        for field in EXPORT_FIELDS:
            self.assertIn(f"`{field}`", self.DOC,
                          f"export column {field} missing from the data dictionary")


if __name__ == "__main__":
    unittest.main()

import os
import sys
import tempfile
from pathlib import Path

import pytest

# Make `app` importable when pytest runs from backend/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Every test session gets a throwaway database, set before app.db.database
# resolves its module-level paths.
_tmpdir = tempfile.mkdtemp(prefix="ap-test-")
os.environ["ASSESSMENT_DATA_DIR"] = _tmpdir
os.environ["ASSESSMENT_DB_PATH"] = str(Path(_tmpdir) / "test.db")

# Tests must never depend on ambient provider credentials — force the
# keyword-fallback path unless a test explicitly monkeypatches the bridge.
for _var in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY",
             "GROQ_API_KEY", "MISTRAL_API_KEY", "GITHUB_MODELS_TOKEN",
             "TAMU_AI_API_KEY", "TAMU_CHAT_API_KEY"):
    os.environ.pop(_var, None)
os.environ["OLLAMA_BASE_URL"] = "http://127.0.0.1:9"  # unroutable — Ollama absent


def _make_client():
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


def _login(c, username, password):
    resp = c.post(
        "/api/auth/login",
        json={"username": username, "password": password},
        headers={"X-Requested-With": "fetch"},
    )
    assert resp.status_code == 200, resp.text
    return c


@pytest.fixture()
def client():
    with _make_client() as c:
        yield c


# Separate TestClient per role so a test can hold both sessions at once.
@pytest.fixture()
def admin_client():
    with _make_client() as c:
        yield _login(c, "admin", "admin123")


@pytest.fixture()
def student_client():
    with _make_client() as c:
        yield _login(c, "emma", "Learn@2024")

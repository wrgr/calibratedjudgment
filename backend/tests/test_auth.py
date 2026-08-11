"""Auth flow: login, session cookie, role gates, CSRF header, prefs."""


def test_login_bad_password(client):
    r = client.post("/api/auth/login",
                    json={"username": "emma", "password": "wrong"},
                    headers={"X-Requested-With": "fetch"})
    assert r.status_code == 401


def test_login_and_me(student_client):
    r = student_client.get("/api/auth/me")
    assert r.status_code == 200
    body = r.json()
    assert body["username"] == "emma"
    assert body["role"] == "student"
    assert "password" not in str(body).lower()


def test_me_requires_session(client):
    assert client.get("/api/auth/me").status_code == 401


def test_mutating_requires_custom_header(student_client):
    # Same session, but a mutating call without X-Requested-With must fail (CSRF guard).
    r = student_client.put("/api/auth/prefs", json={"theme": "dark"})
    assert r.status_code == 403


def test_prefs_roundtrip(student_client):
    r = student_client.put("/api/auth/prefs",
                           json={"theme": "dark", "preferred_provider": "Claude",
                                 "preferred_model": "claude-opus-4-8"},
                           headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200
    body = r.json()
    assert body["theme"] == "dark"
    assert body["preferredProvider"] == "Claude"


def test_logout_kills_session(student_client):
    r = student_client.post("/api/auth/logout", headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200
    assert student_client.get("/api/auth/me").status_code == 401


def test_last_admin_cannot_be_demoted():
    from app.db import database as db
    ok, err = db.update_user("admin", "admin", "Administrator", "student")
    assert not ok
    assert "last remaining admin" in err

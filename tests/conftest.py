"""Test-Fixtures: isoliertes Datenverzeichnis, frischer Seed pro Test."""
from __future__ import annotations

import os
import tempfile

# Muss VOR dem App-Import gesetzt werden – config liest die Umgebungsvariablen
# beim Import ein.
_TEST_DIR = tempfile.mkdtemp(prefix="sb-test-")
os.environ["SB_DATA_DIR"] = _TEST_DIR

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal, init_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import AdminUser, Announcement, Display, Event, Layout, MediaItem, Schedule, Setting  # noqa: E402
from app.seed import seed_if_empty  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def fresh_db(client):
    """Leert alle Tabellen und setzt frische Seed-Daten."""
    db = SessionLocal()
    for model in (Announcement, Event, MediaItem, Schedule, Display, Layout,
                  Setting, AdminUser):
        db.query(model).delete()
    db.commit()
    seed_if_empty(db)
    yield db
    db.close()


@pytest.fixture()
def admin_client(client, fresh_db):
    resp = client.post("/api/admin/login",
                       json={"username": "admin", "password": _admin_password()})
    assert resp.status_code == 200, resp.text
    return client


def _admin_password() -> str:
    from app import config

    return config.INITIAL_PW_FILE.read_text().strip()

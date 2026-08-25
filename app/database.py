from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from . import config

config.ensure_dirs()

engine = create_engine(
    f"sqlite:///{config.DB_PATH}",
    connect_args={"check_same_thread": False},
)

SCHEMA_VERSION = 1


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _record):
    if isinstance(dbapi_conn, sqlite3.Connection):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
        cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Erzeugt Schema und Seed-Daten (idempotent)."""
    from . import models  # noqa: F401
    from .seed import seed_if_empty

    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_if_empty(db)

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base, utcnow


class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[str] = mapped_column(String(20), default="admin")  # admin|editor
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Display(Base):
    """Ein angeschlossenes Anzeigegeraet (Browser-Client)."""

    __tablename__ = "displays"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="Neues Display")
    location: Mapped[str] = mapped_column(String(120), default="")
    resolution: Mapped[str] = mapped_column(String(20), default="")
    orientation: Mapped[str] = mapped_column(String(12), default="landscape")
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    layout_id: Mapped[int | None] = mapped_column(ForeignKey("layouts.id"), nullable=True)
    schedule_id: Mapped[int | None] = mapped_column(ForeignKey("schedules.id"), nullable=True)
    app_version: Mapped[str] = mapped_column(String(20), default="")
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    layout: Mapped["Layout | None"] = relationship(foreign_keys=[layout_id])


class Layout(Base):
    """Layout = Liste von Widgets mit Positionen in Prozent (0–100)."""

    __tablename__ = "layouts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    orientation: Mapped[str] = mapped_column(String(12), default="landscape")
    elements: Mapped[list] = mapped_column(JSON, default=list)
    background: Mapped[dict] = mapped_column(JSON, default=dict)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Announcement(Base):
    """Bekanntmachung mit Prioritaet und Gueltigkeitszeitraum."""

    __tablename__ = "announcements"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    priority: Mapped[int] = mapped_column(Integer, default=1)  # 5=Notfall .. 1=Info
    valid_from: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    valid_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    qr_url: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Event(Base):
    """Veranstaltung im lokalen Kalender."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    start_at: Mapped[datetime] = mapped_column(DateTime)
    end_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    location: Mapped[str] = mapped_column(String(200), default="")
    category: Mapped[str] = mapped_column(String(60), default="Allgemein")
    website: Mapped[str] = mapped_column(String(500), default="")
    featured: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class MediaItem(Base):
    __tablename__ = "media_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str] = mapped_column(String(160), unique=True)
    original_name: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(200), default="")
    mime: Mapped[str] = mapped_column(String(100), default="")
    kind: Mapped[str] = mapped_column(String(10), default="image")  # image|video
    size: Mapped[int] = mapped_column(Integer, default=0)
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    duration: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Schedule(Base):
    """Zeitplan: Regeln, die ein Layout je Wochentag/Zeitfenster zuweisen."""

    __tablename__ = "schedules"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    priority: Mapped[int] = mapped_column(Integer, default=1)  # hoeher gewinnt
    rules: Mapped[list] = mapped_column(JSON, default=list)
    # rule: {"start": "06:00", "end": "09:00", "weekdays": [0..6], "layout_id": int}


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


PRIORITY_LABELS = {
    5: "Notfall",
    4: "Wichtig",
    3: "Veranstaltung",
    2: "Kampagne",
    1: "Info",
}

WEEKDAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

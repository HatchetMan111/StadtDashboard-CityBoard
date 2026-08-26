import os
import secrets
from pathlib import Path

from . import __version__

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("SB_DATA_DIR", BASE_DIR / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "stadtdashboard.db"
SECRET_FILE = DATA_DIR / "secret.key"
INITIAL_PW_FILE = DATA_DIR / "initial_admin_password.txt"

APP_NAME = "StadtDashboard"
VERSION = __version__

HOST = os.environ.get("SB_HOST", "0.0.0.0")
PORT = int(os.environ.get("SB_PORT", "8080"))
TIMEZONE = os.environ.get("SB_TZ", "Europe/Berlin")
MAX_UPLOAD_MB = int(os.environ.get("SB_MAX_UPLOAD_MB", "25"))

DISPLAY_ONLINE_SECONDS = 70

ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"}
ALLOWED_VIDEO_EXT = {".mp4", ".webm"}


def ensure_dirs() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def get_secret_key() -> bytes:
    """Persistenter Secret-Key fuer Session-Signierung (erster Start: generiert)."""
    ensure_dirs()
    if SECRET_FILE.exists():
        return SECRET_FILE.read_bytes().strip()
    key = secrets.token_hex(32).encode()
    SECRET_FILE.write_bytes(key + b"\n")
    try:
        SECRET_FILE.chmod(0o600)
    except OSError:
        pass
    return key

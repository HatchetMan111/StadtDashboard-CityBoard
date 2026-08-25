"""QR-Codes: lokal generiert, keine externe API."""
from __future__ import annotations

import base64
import io
from functools import lru_cache

import qrcode


@lru_cache(maxsize=256)
def qr_data_url(text: str, box_size: int = 8) -> str:
    img = qrcode.QRCode(border=2, box_size=box_size)
    img.add_data(text)
    img.make(fit=True)
    buf = io.BytesIO()
    img.make_image(fill_color="black", back_color="white").save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"

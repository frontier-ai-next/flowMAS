import base64
import hashlib
import os
import threading
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from backend.config import settings

_PREFIX = "enc:v1:"
_KEY_FILE = ".provider-secrets.key"
_KEY_LOCK = threading.Lock()


def _fernet() -> Fernet:
    configured = os.environ.get("GMAS_PROVIDER_SECRET_KEY", "").strip()
    if configured:
        key = base64.urlsafe_b64encode(
            hashlib.sha256(configured.encode("utf-8")).digest()
        )
        return Fernet(key)

    key_path = Path(settings.data_dir) / _KEY_FILE
    with _KEY_LOCK:
        key_path.parent.mkdir(parents=True, exist_ok=True)
        if not key_path.exists():
            try:
                with key_path.open("xb") as handle:
                    handle.write(Fernet.generate_key())
                key_path.chmod(0o600)
            except FileExistsError:
                pass
        key = key_path.read_bytes().strip()
    return Fernet(key)


def encrypt_secret(value: str | None) -> str | None:
    if not value or value.startswith("$") or value.startswith(_PREFIX):
        return value
    token = _fernet().encrypt(value.encode("utf-8")).decode("ascii")
    return f"{_PREFIX}{token}"


def decrypt_secret(value: str | None) -> str | None:
    if not value or not value.startswith(_PREFIX):
        return value
    try:
        return _fernet().decrypt(value[len(_PREFIX) :].encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None

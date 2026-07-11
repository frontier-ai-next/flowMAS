"""Small deterministic privacy filter applied before data leaves a process."""

import re
from typing import Any

_SENSITIVE_KEYS = {
    "api_key",
    "apikey",
    "authorization",
    "cookie",
    "password",
    "secret",
    "token",
}
_BEARER = re.compile(r"(?i)bearer\s+[a-z0-9._~+/=-]+")


def redact(value: Any, *, max_string_length: int = 32_000) -> Any:
    """Recursively redact secret-like fields and bound payload sizes."""
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            normalized = str(key).lower().replace("-", "_")
            if normalized in _SENSITIVE_KEYS or normalized.endswith("_api_key"):
                result[str(key)] = "[REDACTED]"
            else:
                result[str(key)] = redact(item, max_string_length=max_string_length)
        return result
    if isinstance(value, (list, tuple)):
        return [redact(item, max_string_length=max_string_length) for item in value]
    if isinstance(value, str):
        cleaned = _BEARER.sub("Bearer [REDACTED]", value)
        if len(cleaned) > max_string_length:
            return cleaned[:max_string_length] + "…[TRUNCATED]"
        return cleaned
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)

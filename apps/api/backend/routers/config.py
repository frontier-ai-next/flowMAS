"""Configuration endpoints for runner defaults and LLM providers."""

import os

from fastapi import APIRouter, HTTPException

from backend.models.execution import LLMProviderConfig, RunnerConfigSchema
from backend.services.secret_service import decrypt_secret, encrypt_secret
from backend.services.storage_service import storage
from backend.session import get_current_session_id, try_get_current_session_id

router = APIRouter(prefix="/api/config", tags=["config"])

_LLM_PROVIDERS_KEY = "__llm_providers__"
_llm_providers_by_session: dict[str, list[LLMProviderConfig]] = {}


def _session_providers() -> list[LLMProviderConfig]:
    """Return LLM providers for the active browser session."""
    session_id = try_get_current_session_id()
    if session_id is None:
        return []

    if session_id in _llm_providers_by_session:
        return _llm_providers_by_session[session_id]

    data = storage.get_graph(_LLM_PROVIDERS_KEY)
    if data and "providers" in data:
        raw_providers = data["providers"]
        providers = [
            LLMProviderConfig(
                **{
                    **provider,
                    "api_key": decrypt_secret(provider.get("api_key")),
                }
            )
            for provider in raw_providers
        ]
        if any(
            provider.get("api_key")
            and not str(provider["api_key"]).startswith(("$", "enc:v1:"))
            for provider in raw_providers
        ):
            storage.save_graph(
                _LLM_PROVIDERS_KEY,
                {
                    "name": _LLM_PROVIDERS_KEY,
                    "providers": [
                        {
                            **provider.model_dump(),
                            "api_key": encrypt_secret(provider.api_key),
                        }
                        for provider in providers
                    ],
                },
            )
    else:
        providers = []
    _llm_providers_by_session[session_id] = providers
    return providers


def _save_providers(providers: list[LLMProviderConfig]) -> None:
    """Persist providers for the active browser session."""
    session_id = get_current_session_id()
    _llm_providers_by_session[session_id] = providers
    storage.save_graph(
        _LLM_PROVIDERS_KEY,
        {
            "name": _LLM_PROVIDERS_KEY,
            "providers": [
                {**provider.model_dump(), "api_key": encrypt_secret(provider.api_key)}
                for provider in providers
            ],
        },
    )


def _resolve_api_key(value: str | None) -> str:
    if not value:
        return ""
    value = value.strip()
    if value.startswith("$"):
        return os.environ.get(value[1:], "").strip()
    return value


def _provider_has_api_key(provider: LLMProviderConfig) -> bool:
    return bool(_resolve_api_key(provider.api_key))


def get_llm_provider(provider_id: str) -> LLMProviderConfig | None:
    """Return a stored provider with api_key intact (server-side only)."""
    for provider in _session_providers():
        if provider.provider_id == provider_id:
            return provider
    return None


def get_llm_providers_internal() -> list[LLMProviderConfig]:
    return list(_session_providers())


def _normalize_provider_base_url(base_url: str | None) -> str | None:
    if not base_url:
        return base_url
    url = base_url.rstrip("/")
    if url.endswith("/chat/completions"):
        url = url[: -len("/chat/completions")].rstrip("/")
    from urllib.parse import urlparse

    path = urlparse(url).path
    if path in ("", "/"):
        return f"{url}/v1"
    return url


def resolve_llm_provider(provider_id: str | None = None) -> LLMProviderConfig | None:
    """Resolve workflow LLM provider from Settings storage."""
    providers = _session_providers()
    if not providers:
        return None
    if provider_id:
        return get_llm_provider(provider_id)
    return next((p for p in providers if _provider_has_api_key(p)), providers[0])


@router.get("/runner-defaults", response_model=RunnerConfigSchema)
def get_runner_defaults():
    """Get default runner configuration."""
    return RunnerConfigSchema()


@router.get("/llm-providers", response_model=list[LLMProviderConfig])
def list_llm_providers():
    return [p.model_copy(update={"api_key": None}) for p in _session_providers()]


@router.post("/llm-providers", response_model=LLMProviderConfig, status_code=201)
def add_llm_provider(req: LLMProviderConfig):
    providers = list(_session_providers())
    existing = next((p for p in providers if p.provider_id == req.provider_id), None)

    # Upsert by provider_id
    providers = [p for p in providers if p.provider_id != req.provider_id]
    normalized = req.model_copy(update={"base_url": _normalize_provider_base_url(req.base_url)})
    # UI never re-sends api_key on model/url-only edits — keep the stored secret.
    if existing and not (normalized.api_key or "").strip():
        normalized = normalized.model_copy(update={"api_key": existing.api_key})
    providers.append(normalized)
    _save_providers(providers)
    return normalized.model_copy(update={"api_key": None})


@router.delete("/llm-providers/{provider_id}", status_code=204)
def delete_llm_provider(provider_id: str):
    providers = list(_session_providers())
    before = len(providers)
    providers = [p for p in providers if p.provider_id != provider_id]
    if len(providers) == before:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found")
    _save_providers(providers)

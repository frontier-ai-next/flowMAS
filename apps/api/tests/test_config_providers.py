"""LLM provider configuration tests."""

import backend.services.storage_service as storage_svc
from backend.models.execution import LLMProviderConfig
from backend.routers import config as config_router
from backend.session import new_session_id, session_scope


def test_upsert_preserves_api_key_when_not_resent():
    storage = storage_svc.storage
    session_id = new_session_id()
    with session_scope(session_id):
        config_router.add_llm_provider(
            LLMProviderConfig(
                provider_id="mars",
                provider_type="openai",
                display_name="Mars",
                base_url="https://gateway.frontierai.ru/v1",
                api_key="sk-secret",
                default_model="model-a",
            )
        )
        config_router.add_llm_provider(
            LLMProviderConfig(
                provider_id="mars",
                provider_type="openai",
                display_name="Mars",
                base_url="https://gateway.frontierai.ru/v1",
                default_model="model-b",
            )
        )
        stored = config_router.get_llm_provider("mars")
        assert stored is not None
        assert stored.api_key == "sk-secret"
        assert stored.default_model == "model-b"
        persisted = storage.get_graph("__llm_providers__")
        assert persisted is not None
        persisted_key = persisted["providers"][0]["api_key"]
        assert persisted_key.startswith("enc:v1:")
        assert "sk-secret" not in str(persisted)

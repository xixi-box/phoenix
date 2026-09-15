from __future__ import annotations

import json

import httpx
import pytest

from phoenix.client.__generated__ import v1
from phoenix.client.constants.server_requirements import (
    CREATE_EVALUATOR_VERSION,
    GET_EVALUATOR,
    PATCH_EVALUATOR,
)
from phoenix.client.resources.evaluators import AsyncEvaluators, Evaluators
from phoenix.client.types.prompts import PromptVersion

EVALUATOR_ID = "RXZhbHVhdG9yOjE="


def _make_llm_definition(**overrides: object) -> v1.LLMEvaluatorDefinition:
    definition: v1.LLMEvaluatorDefinition = {
        "type": "llm",
        "evaluator_id": EVALUATOR_ID,
        "name": "toxicity",
        "description": None,
        "prompt_version": None,
        "output_configs": [
            {
                "type": "CATEGORICAL",
                "name": "toxicity",
                "optimization_direction": "MINIMIZE",
                "values": [{"label": "toxic", "score": 1}, {"label": "clean", "score": 0}],
            }
        ],
    }
    definition.update(overrides)  # type: ignore[typeddict-item]
    return definition


def _make_code_definition() -> v1.CodeEvaluatorDefinition:
    return {
        "type": "code",
        "evaluator_id": EVALUATOR_ID,
        "name": "exact-match",
        "description": None,
        "language": "PYTHON",
        "sandbox_config_id": "U2FuZGJveENvbmZpZzox",
        "input_mapping": {"literal_mapping": {}, "path_mapping": {"output": "output"}},
        "output_configs": [],
        "evaluator_version_id": "Q29kZUV2YWx1YXRvclZlcnNpb246MQ==",
        "source_code": "def evaluate(output: str) -> float:\n    return 1.0\n",
    }


class _GuardSentinel(Exception):
    pass


def _refusing_guard(requirement: object) -> object:
    class _Guard:
        def require(self, candidate: object) -> None:
            if candidate is requirement:
                raise _GuardSentinel

    return _Guard()


def _unreachable_client() -> httpx.Client:
    return httpx.Client(
        transport=httpx.MockTransport(lambda r: pytest.fail("transport must not be reached")),
        base_url="http://test",
    )


class TestEvaluatorsGet:
    def test_get_requests_definition_by_id(self) -> None:
        definition = _make_code_definition()

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "GET"
            assert request.url.path == f"/v1/evaluators/{EVALUATOR_ID}"
            return httpx.Response(200, json={"data": definition})

        client = httpx.Client(transport=httpx.MockTransport(handler), base_url="http://test")
        result = Evaluators(client).get(evaluator_id=EVALUATOR_ID)
        assert result == definition
        assert result["type"] == "code"

    def test_get_calls_guard_before_request(self) -> None:
        with pytest.raises(_GuardSentinel):
            Evaluators(
                _unreachable_client(),
                _guard=_refusing_guard(GET_EVALUATOR),  # type: ignore[arg-type]
            ).get(evaluator_id=EVALUATOR_ID)


class TestEvaluatorsUpdateLlm:
    def test_update_llm_sends_only_given_fields(self) -> None:
        updated = _make_llm_definition(description="updated")

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "PATCH"
            assert request.url.path == f"/v1/evaluators/{EVALUATOR_ID}"
            assert json.loads(request.content) == {"type": "llm", "description": "updated"}
            return httpx.Response(200, json={"data": updated})

        client = httpx.Client(transport=httpx.MockTransport(handler), base_url="http://test")
        result = Evaluators(client).update_llm(evaluator_id=EVALUATOR_ID, description="updated")
        assert result == updated

    def test_update_llm_serializes_prompt_version_helper(self) -> None:
        prompt_version = PromptVersion(
            [{"role": "user", "content": "Is this toxic? {{output}}"}],
            model_name="gpt-4o",
        )

        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            assert body["type"] == "llm"
            assert body["prompt_version"]["model_name"] == "gpt-4o"
            assert body["prompt_version"]["template"]["type"] == "chat"
            return httpx.Response(200, json={"data": _make_llm_definition()})

        client = httpx.Client(transport=httpx.MockTransport(handler), base_url="http://test")
        Evaluators(client).update_llm(evaluator_id=EVALUATOR_ID, prompt_version=prompt_version)

    def test_update_llm_requires_a_field(self) -> None:
        with pytest.raises(ValueError, match="At least one field"):
            Evaluators(_unreachable_client()).update_llm(evaluator_id=EVALUATOR_ID)

    def test_update_llm_calls_guard_before_request(self) -> None:
        with pytest.raises(_GuardSentinel):
            Evaluators(
                _unreachable_client(),
                _guard=_refusing_guard(PATCH_EVALUATOR),  # type: ignore[arg-type]
            ).update_llm(evaluator_id=EVALUATOR_ID, name="x")


class TestEvaluatorsUpdateCode:
    def test_update_code_sends_only_given_fields(self) -> None:
        updated = _make_code_definition()
        input_mapping: v1.InputMapping = {
            "literal_mapping": {"threshold": 0.5},
            "path_mapping": {"output": "output.text"},
        }

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "PATCH"
            assert json.loads(request.content) == {
                "type": "code",
                "name": "renamed",
                "input_mapping": input_mapping,
            }
            return httpx.Response(200, json={"data": updated})

        client = httpx.Client(transport=httpx.MockTransport(handler), base_url="http://test")
        result = Evaluators(client).update_code(
            evaluator_id=EVALUATOR_ID, name="renamed", input_mapping=input_mapping
        )
        assert result == updated

    def test_update_code_requires_a_field(self) -> None:
        with pytest.raises(ValueError, match="At least one field"):
            Evaluators(_unreachable_client()).update_code(evaluator_id=EVALUATOR_ID)


class TestEvaluatorsCreateVersion:
    def test_create_version_posts_source_code(self) -> None:
        version: v1.CodeEvaluatorVersion = {
            "evaluator_id": EVALUATOR_ID,
            "evaluator_version_id": "Q29kZUV2YWx1YXRvclZlcnNpb246Mg==",
            "source_code": "def evaluate(output: str) -> float:\n    return 0.0\n",
            "was_created": True,
        }

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "POST"
            assert request.url.path == f"/v1/evaluators/{EVALUATOR_ID}/versions"
            assert json.loads(request.content) == {"source_code": version["source_code"]}
            return httpx.Response(201, json={"data": version})

        client = httpx.Client(transport=httpx.MockTransport(handler), base_url="http://test")
        result = Evaluators(client).create_version(
            evaluator_id=EVALUATOR_ID, source_code=version["source_code"]
        )
        assert result == version

    def test_create_version_accepts_unchanged_source(self) -> None:
        version: v1.CodeEvaluatorVersion = {
            "evaluator_id": EVALUATOR_ID,
            "evaluator_version_id": "Q29kZUV2YWx1YXRvclZlcnNpb246MQ==",
            "source_code": "x",
            "was_created": False,
        }
        client = httpx.Client(
            transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"data": version})),
            base_url="http://test",
        )
        result = Evaluators(client).create_version(evaluator_id=EVALUATOR_ID, source_code="x")
        assert result["was_created"] is False

    def test_create_version_calls_guard_before_request(self) -> None:
        with pytest.raises(_GuardSentinel):
            Evaluators(
                _unreachable_client(),
                _guard=_refusing_guard(CREATE_EVALUATOR_VERSION),  # type: ignore[arg-type]
            ).create_version(evaluator_id=EVALUATOR_ID, source_code="x")


class TestAsyncEvaluators:
    @pytest.mark.asyncio
    async def test_get_requests_definition_by_id(self) -> None:
        definition = _make_llm_definition()

        async def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.path == f"/v1/evaluators/{EVALUATOR_ID}"
            return httpx.Response(200, json={"data": definition})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://test")
        result = await AsyncEvaluators(client).get(evaluator_id=EVALUATOR_ID)
        assert result == definition

    @pytest.mark.asyncio
    async def test_update_llm_sends_only_given_fields(self) -> None:
        updated = _make_llm_definition(name="renamed")

        async def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "PATCH"
            assert json.loads(request.content) == {"type": "llm", "name": "renamed"}
            return httpx.Response(200, json={"data": updated})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://test")
        result = await AsyncEvaluators(client).update_llm(evaluator_id=EVALUATOR_ID, name="renamed")
        assert result == updated

    @pytest.mark.asyncio
    async def test_update_code_requires_a_field(self) -> None:
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda r: pytest.fail("transport must not be reached")),
            base_url="http://test",
        )
        with pytest.raises(ValueError, match="At least one field"):
            await AsyncEvaluators(client).update_code(evaluator_id=EVALUATOR_ID)

    @pytest.mark.asyncio
    async def test_create_version_posts_source_code(self) -> None:
        version: v1.CodeEvaluatorVersion = {
            "evaluator_id": EVALUATOR_ID,
            "evaluator_version_id": "Q29kZUV2YWx1YXRvclZlcnNpb246Mg==",
            "source_code": "x",
            "was_created": True,
        }

        async def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "POST"
            assert request.url.path == f"/v1/evaluators/{EVALUATOR_ID}/versions"
            assert json.loads(request.content) == {"source_code": "x"}
            return httpx.Response(201, json={"data": version})

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://test")
        result = await AsyncEvaluators(client).create_version(
            evaluator_id=EVALUATOR_ID, source_code="x"
        )
        assert result == version

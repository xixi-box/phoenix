from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Union, cast

import httpx

from phoenix.client.__generated__ import v1
from phoenix.client.constants.server_requirements import (
    CREATE_EVALUATOR_VERSION,
    GET_EVALUATOR,
    PATCH_EVALUATOR,
)
from phoenix.client.types.prompts import PromptVersion
from phoenix.client.types.sentinels import NOT_GIVEN, NotGiven
from phoenix.client.utils.encode_path_param import encode_path_param
from phoenix.client.utils.server_requirements import (
    AsyncServerVersionGuard,
    ServerVersionGuard,
)

logger = logging.getLogger(__name__)

EvaluatorDefinition = Union[
    v1.LLMEvaluatorDefinition,
    v1.CodeEvaluatorDefinition,
    v1.BuiltInEvaluatorDefinition,
]
"""A shared evaluator definition. The ``type`` field discriminates the variants."""

EvaluatorOutputConfig = Union[
    v1.CategoricalAnnotationConfigData,
    v1.ContinuousOutputConfig,
    v1.FreeformOutputConfig,
]
"""An output configuration accepted by code evaluators."""


def _build_llm_patch(
    *,
    name: Union[str, NotGiven],
    description: Union[str, NotGiven],
    prompt_version: Union[PromptVersion, v1.PromptVersionData, NotGiven],
    prompt_version_id: Union[str, NotGiven],
    output_configs: Union[Sequence[v1.CategoricalAnnotationConfigData], NotGiven],
) -> v1.PatchLLMEvaluatorRequest:
    body = v1.PatchLLMEvaluatorRequest(type="llm")
    if not isinstance(name, NotGiven):
        body["name"] = name
    if not isinstance(description, NotGiven):
        body["description"] = description
    if isinstance(prompt_version, PromptVersion):
        body["prompt_version"] = prompt_version._dumps()  # pyright: ignore[reportPrivateUsage]
    elif not isinstance(prompt_version, NotGiven):
        body["prompt_version"] = prompt_version
    if not isinstance(prompt_version_id, NotGiven):
        body["prompt_version_id"] = prompt_version_id
    if not isinstance(output_configs, NotGiven):
        body["output_configs"] = list(output_configs)
    if len(body) == 1:
        raise ValueError("At least one field to update must be provided.")
    return body


def _build_code_patch(
    *,
    name: Union[str, NotGiven],
    description: Union[str, NotGiven],
    sandbox_config_id: Union[str, NotGiven],
    input_mapping: Union[v1.InputMapping, NotGiven],
    output_configs: Union[Sequence[EvaluatorOutputConfig], NotGiven],
) -> v1.PatchCodeEvaluatorRequest:
    body = v1.PatchCodeEvaluatorRequest(type="code")
    if not isinstance(name, NotGiven):
        body["name"] = name
    if not isinstance(description, NotGiven):
        body["description"] = description
    if not isinstance(sandbox_config_id, NotGiven):
        body["sandbox_config_id"] = sandbox_config_id
    if not isinstance(input_mapping, NotGiven):
        body["input_mapping"] = input_mapping
    if not isinstance(output_configs, NotGiven):
        body["output_configs"] = list(output_configs)
    if len(body) == 1:
        raise ValueError("At least one field to update must be provided.")
    return body


class Evaluators:
    """Client for the shared evaluator definitions API.

    Definitions are shared by every project and dataset binding that references
    them, so an update here applies everywhere the evaluator is used.

    Examples:
        Basic operations::

            from phoenix.client import Client
            client = Client()

            definition = client.evaluators.get(evaluator_id="RXZhbHVhdG9yOjE=")
            print(definition["type"], definition["name"])

            client.evaluators.update_llm(
                evaluator_id="RXZhbHVhdG9yOjE=",
                description="Flags responses that contradict the retrieved context",
            )

            version = client.evaluators.create_version(
                evaluator_id="RXZhbHVhdG9yOjI=",
                source_code="def evaluate(output: str) -> float:\\n    return 1.0\\n",
            )
            print(version["was_created"])
    """

    def __init__(
        self,
        client: httpx.Client,
        *,
        _guard: ServerVersionGuard | None = None,
    ) -> None:
        """Initialize the Evaluators client.

        Args:
            client (httpx.Client): The httpx client to use for making requests.
        """
        self._client = client
        self._guard = _guard or ServerVersionGuard(client)

    def get(self, *, evaluator_id: str) -> EvaluatorDefinition:
        """Get a shared evaluator definition by ID.

        Args:
            evaluator_id (str): The ID of the evaluator.

        Returns:
            The LLM, code, or built-in evaluator definition. Inspect ``type`` to
            tell them apart.

        Raises:
            httpx.HTTPError: If the request fails.

        Example::

            from phoenix.client import Client
            client = Client()

            definition = client.evaluators.get(evaluator_id="RXZhbHVhdG9yOjE=")
            if definition["type"] == "code":
                print(definition["source_code"])
        """  # noqa: E501
        self._guard.require(GET_EVALUATOR)
        url = f"v1/evaluators/{encode_path_param(evaluator_id)}"
        response = self._client.get(url)
        response.raise_for_status()
        return cast(v1.EvaluatorDefinitionResponseBody, response.json())["data"]

    def update_llm(
        self,
        *,
        evaluator_id: str,
        name: Union[str, NotGiven] = NOT_GIVEN,
        description: Union[str, NotGiven] = NOT_GIVEN,
        prompt_version: Union[PromptVersion, v1.PromptVersionData, NotGiven] = NOT_GIVEN,
        prompt_version_id: Union[str, NotGiven] = NOT_GIVEN,
        output_configs: Union[Sequence[v1.CategoricalAnnotationConfigData], NotGiven] = NOT_GIVEN,
    ) -> v1.LLMEvaluatorDefinition:
        """Update a shared LLM evaluator. Omitted fields keep their current values.

        Args:
            evaluator_id (str): The ID of the LLM evaluator.
            name (str): A new name for the evaluator.
            description (str): A new description.
            prompt_version (PromptVersion | v1.PromptVersionData): Prompt content
                for a new prompt version. The template must be a chat template.
            prompt_version_id (str): The ID of an existing prompt version to use
                instead of supplying new content.
            output_configs (Sequence[v1.CategoricalAnnotationConfigData]): The
                categorical outputs the evaluator produces.

        Returns:
            The updated LLM evaluator definition.

        Raises:
            httpx.HTTPError: If the request fails.
            ValueError: If no field to update is provided.

        Example::

            from phoenix.client import Client
            from phoenix.client.types import PromptVersion
            client = Client()

            client.evaluators.update_llm(
                evaluator_id="RXZhbHVhdG9yOjE=",
                prompt_version=PromptVersion(
                    [{"role": "user", "content": "Is this toxic? {{output}}"}],
                    model_name="gpt-4o",
                ),
            )
        """  # noqa: E501
        json_ = _build_llm_patch(
            name=name,
            description=description,
            prompt_version=prompt_version,
            prompt_version_id=prompt_version_id,
            output_configs=output_configs,
        )
        self._guard.require(PATCH_EVALUATOR)
        url = f"v1/evaluators/{encode_path_param(evaluator_id)}"
        response = self._client.patch(url, json=json_)
        response.raise_for_status()
        data = cast(v1.EvaluatorDefinitionResponseBody, response.json())["data"]
        return cast(v1.LLMEvaluatorDefinition, data)

    def update_code(
        self,
        *,
        evaluator_id: str,
        name: Union[str, NotGiven] = NOT_GIVEN,
        description: Union[str, NotGiven] = NOT_GIVEN,
        sandbox_config_id: Union[str, NotGiven] = NOT_GIVEN,
        input_mapping: Union[v1.InputMapping, NotGiven] = NOT_GIVEN,
        output_configs: Union[Sequence[EvaluatorOutputConfig], NotGiven] = NOT_GIVEN,
    ) -> v1.CodeEvaluatorDefinition:
        """Update a shared code evaluator. Omitted fields keep their current values.

        Source code is immutable per version; use :meth:`create_version` to append
        new code.

        Args:
            evaluator_id (str): The ID of the code evaluator.
            name (str): A new name for the evaluator.
            description (str): A new description.
            sandbox_config_id (str): The ID of the sandbox configuration to run in.
            input_mapping (v1.InputMapping): The default mapping from record
                fields to evaluator arguments.
            output_configs (Sequence[EvaluatorOutputConfig]): The outputs the
                evaluator produces.

        Returns:
            The updated code evaluator definition.

        Raises:
            httpx.HTTPError: If the request fails.
            ValueError: If no field to update is provided.

        Example::

            from phoenix.client import Client
            client = Client()

            client.evaluators.update_code(
                evaluator_id="RXZhbHVhdG9yOjI=",
                input_mapping={"literal_mapping": {}, "path_mapping": {"output": "output"}},
            )
        """  # noqa: E501
        json_ = _build_code_patch(
            name=name,
            description=description,
            sandbox_config_id=sandbox_config_id,
            input_mapping=input_mapping,
            output_configs=output_configs,
        )
        self._guard.require(PATCH_EVALUATOR)
        url = f"v1/evaluators/{encode_path_param(evaluator_id)}"
        response = self._client.patch(url, json=json_)
        response.raise_for_status()
        data = cast(v1.EvaluatorDefinitionResponseBody, response.json())["data"]
        return cast(v1.CodeEvaluatorDefinition, data)

    def create_version(
        self,
        *,
        evaluator_id: str,
        source_code: str,
    ) -> v1.CodeEvaluatorVersion:
        """Append a new immutable version of a code evaluator's source.

        If the source matches the current version, the existing version is
        returned and ``was_created`` is ``False``.

        Args:
            evaluator_id (str): The ID of the code evaluator.
            source_code (str): The full source of the new version.

        Returns:
            The persisted code version.

        Raises:
            httpx.HTTPError: If the request fails.

        Example::

            from phoenix.client import Client
            client = Client()

            version = client.evaluators.create_version(
                evaluator_id="RXZhbHVhdG9yOjI=",
                source_code=open("evaluator.py").read(),
            )
            print(version["evaluator_version_id"], version["was_created"])
        """  # noqa: E501
        self._guard.require(CREATE_EVALUATOR_VERSION)
        url = f"v1/evaluators/{encode_path_param(evaluator_id)}/versions"
        json_ = v1.CodeEvaluatorVersionRequest(source_code=source_code)
        response = self._client.post(url, json=json_)
        response.raise_for_status()
        return cast(v1.ResponseBodyCodeEvaluatorVersion, response.json())["data"]


class AsyncEvaluators:
    """Asynchronous client for the shared evaluator definitions API.

    Definitions are shared by every project and dataset binding that references
    them, so an update here applies everywhere the evaluator is used.

    Examples:
        Basic operations::

            from phoenix.client import AsyncClient
            client = AsyncClient()

            definition = await client.evaluators.get(evaluator_id="RXZhbHVhdG9yOjE=")
            print(definition["type"], definition["name"])

            await client.evaluators.update_llm(
                evaluator_id="RXZhbHVhdG9yOjE=",
                description="Flags responses that contradict the retrieved context",
            )

            version = await client.evaluators.create_version(
                evaluator_id="RXZhbHVhdG9yOjI=",
                source_code="def evaluate(output: str) -> float:\\n    return 1.0\\n",
            )
            print(version["was_created"])
    """

    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        _guard: AsyncServerVersionGuard | None = None,
    ) -> None:
        """Initialize the AsyncEvaluators client.

        Args:
            client (httpx.AsyncClient): The httpx client to use for making requests.
        """
        self._client = client
        self._guard = _guard or AsyncServerVersionGuard(client)

    async def get(self, *, evaluator_id: str) -> EvaluatorDefinition:
        """Get a shared evaluator definition by ID.

        Args:
            evaluator_id (str): The ID of the evaluator.

        Returns:
            The LLM, code, or built-in evaluator definition. Inspect ``type`` to
            tell them apart.

        Raises:
            httpx.HTTPError: If the request fails.

        Example::

            from phoenix.client import AsyncClient
            client = AsyncClient()

            definition = await client.evaluators.get(evaluator_id="RXZhbHVhdG9yOjE=")
            if definition["type"] == "code":
                print(definition["source_code"])
        """  # noqa: E501
        await self._guard.require(GET_EVALUATOR)
        url = f"v1/evaluators/{encode_path_param(evaluator_id)}"
        response = await self._client.get(url)
        response.raise_for_status()
        return cast(v1.EvaluatorDefinitionResponseBody, response.json())["data"]

    async def update_llm(
        self,
        *,
        evaluator_id: str,
        name: Union[str, NotGiven] = NOT_GIVEN,
        description: Union[str, NotGiven] = NOT_GIVEN,
        prompt_version: Union[PromptVersion, v1.PromptVersionData, NotGiven] = NOT_GIVEN,
        prompt_version_id: Union[str, NotGiven] = NOT_GIVEN,
        output_configs: Union[Sequence[v1.CategoricalAnnotationConfigData], NotGiven] = NOT_GIVEN,
    ) -> v1.LLMEvaluatorDefinition:
        """Update a shared LLM evaluator. Omitted fields keep their current values.

        Args:
            evaluator_id (str): The ID of the LLM evaluator.
            name (str): A new name for the evaluator.
            description (str): A new description.
            prompt_version (PromptVersion | v1.PromptVersionData): Prompt content
                for a new prompt version. The template must be a chat template.
            prompt_version_id (str): The ID of an existing prompt version to use
                instead of supplying new content.
            output_configs (Sequence[v1.CategoricalAnnotationConfigData]): The
                categorical outputs the evaluator produces.

        Returns:
            The updated LLM evaluator definition.

        Raises:
            httpx.HTTPError: If the request fails.
            ValueError: If no field to update is provided.

        Example::

            from phoenix.client import AsyncClient
            from phoenix.client.types import PromptVersion
            client = AsyncClient()

            await client.evaluators.update_llm(
                evaluator_id="RXZhbHVhdG9yOjE=",
                prompt_version=PromptVersion(
                    [{"role": "user", "content": "Is this toxic? {{output}}"}],
                    model_name="gpt-4o",
                ),
            )
        """  # noqa: E501
        json_ = _build_llm_patch(
            name=name,
            description=description,
            prompt_version=prompt_version,
            prompt_version_id=prompt_version_id,
            output_configs=output_configs,
        )
        await self._guard.require(PATCH_EVALUATOR)
        url = f"v1/evaluators/{encode_path_param(evaluator_id)}"
        response = await self._client.patch(url, json=json_)
        response.raise_for_status()
        data = cast(v1.EvaluatorDefinitionResponseBody, response.json())["data"]
        return cast(v1.LLMEvaluatorDefinition, data)

    async def update_code(
        self,
        *,
        evaluator_id: str,
        name: Union[str, NotGiven] = NOT_GIVEN,
        description: Union[str, NotGiven] = NOT_GIVEN,
        sandbox_config_id: Union[str, NotGiven] = NOT_GIVEN,
        input_mapping: Union[v1.InputMapping, NotGiven] = NOT_GIVEN,
        output_configs: Union[Sequence[EvaluatorOutputConfig], NotGiven] = NOT_GIVEN,
    ) -> v1.CodeEvaluatorDefinition:
        """Update a shared code evaluator. Omitted fields keep their current values.

        Source code is immutable per version; use :meth:`create_version` to append
        new code.

        Args:
            evaluator_id (str): The ID of the code evaluator.
            name (str): A new name for the evaluator.
            description (str): A new description.
            sandbox_config_id (str): The ID of the sandbox configuration to run in.
            input_mapping (v1.InputMapping): The default mapping from record
                fields to evaluator arguments.
            output_configs (Sequence[EvaluatorOutputConfig]): The outputs the
                evaluator produces.

        Returns:
            The updated code evaluator definition.

        Raises:
            httpx.HTTPError: If the request fails.
            ValueError: If no field to update is provided.

        Example::

            from phoenix.client import AsyncClient
            client = AsyncClient()

            await client.evaluators.update_code(
                evaluator_id="RXZhbHVhdG9yOjI=",
                input_mapping={"literal_mapping": {}, "path_mapping": {"output": "output"}},
            )
        """  # noqa: E501
        json_ = _build_code_patch(
            name=name,
            description=description,
            sandbox_config_id=sandbox_config_id,
            input_mapping=input_mapping,
            output_configs=output_configs,
        )
        await self._guard.require(PATCH_EVALUATOR)
        url = f"v1/evaluators/{encode_path_param(evaluator_id)}"
        response = await self._client.patch(url, json=json_)
        response.raise_for_status()
        data = cast(v1.EvaluatorDefinitionResponseBody, response.json())["data"]
        return cast(v1.CodeEvaluatorDefinition, data)

    async def create_version(
        self,
        *,
        evaluator_id: str,
        source_code: str,
    ) -> v1.CodeEvaluatorVersion:
        """Append a new immutable version of a code evaluator's source.

        If the source matches the current version, the existing version is
        returned and ``was_created`` is ``False``.

        Args:
            evaluator_id (str): The ID of the code evaluator.
            source_code (str): The full source of the new version.

        Returns:
            The persisted code version.

        Raises:
            httpx.HTTPError: If the request fails.

        Example::

            from phoenix.client import AsyncClient
            client = AsyncClient()

            version = await client.evaluators.create_version(
                evaluator_id="RXZhbHVhdG9yOjI=",
                source_code=open("evaluator.py").read(),
            )
            print(version["evaluator_version_id"], version["was_created"])
        """  # noqa: E501
        await self._guard.require(CREATE_EVALUATOR_VERSION)
        url = f"v1/evaluators/{encode_path_param(evaluator_id)}/versions"
        json_ = v1.CodeEvaluatorVersionRequest(source_code=source_code)
        response = await self._client.post(url, json=json_)
        response.raise_for_status()
        return cast(v1.ResponseBodyCodeEvaluatorVersion, response.json())["data"]

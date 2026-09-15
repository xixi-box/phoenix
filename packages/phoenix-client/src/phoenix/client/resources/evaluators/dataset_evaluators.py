from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Optional, Union, cast

import httpx

from phoenix.client.__generated__ import v1
from phoenix.client.constants.server_requirements import (
    CREATE_DATASET_EVALUATOR,
    DELETE_DATASET_EVALUATOR,
    DELETE_DATASET_EVALUATORS,
    GET_DATASET_EVALUATOR,
    LIST_DATASET_EVALUATORS,
    PATCH_DATASET_EVALUATOR,
)
from phoenix.client.types.evaluators import DatasetEvaluatorInput, EvaluatorOutputConfig
from phoenix.client.types.sentinels import NOT_GIVEN, NotGiven
from phoenix.client.utils.encode_path_param import encode_path_param
from phoenix.client.utils.server_requirements import (
    AsyncServerVersionGuard,
    ServerVersionGuard,
)

logger = logging.getLogger(__name__)

_PAGE_SIZE = 100


def _build_create_body(
    *,
    name: str,
    input_mapping: v1.InputMapping,
    evaluator: Union[DatasetEvaluatorInput, NotGiven],
    evaluator_id: Union[str, NotGiven],
    description: Union[str, NotGiven],
    output_configs: Union[Sequence[EvaluatorOutputConfig], NotGiven],
) -> v1.CreateDatasetEvaluatorRequest:
    if isinstance(evaluator, NotGiven) == isinstance(evaluator_id, NotGiven):
        raise ValueError("Exactly one of evaluator or evaluator_id must be provided.")
    if isinstance(evaluator, NotGiven):
        assert not isinstance(evaluator_id, NotGiven)
        evaluator = v1.ExistingDatasetEvaluator(type="reference", evaluator_id=evaluator_id)
    body = v1.CreateDatasetEvaluatorRequest(
        name=name,
        input_mapping=input_mapping,
        evaluator=evaluator,
    )
    if not isinstance(description, NotGiven):
        body["description"] = description
    if not isinstance(output_configs, NotGiven):
        body["output_configs"] = list(output_configs)
    return body


def _build_patch_body(
    *,
    name: Union[str, NotGiven],
    input_mapping: Union[v1.InputMapping, NotGiven],
    description: Union[str, NotGiven],
    output_configs: Union[Sequence[EvaluatorOutputConfig], NotGiven],
) -> v1.PatchDatasetEvaluatorRequest:
    body = v1.PatchDatasetEvaluatorRequest()
    if not isinstance(name, NotGiven):
        body["name"] = name
    if not isinstance(input_mapping, NotGiven):
        body["input_mapping"] = input_mapping
    if not isinstance(description, NotGiven):
        body["description"] = description
    if not isinstance(output_configs, NotGiven):
        body["output_configs"] = list(output_configs)
    if not body:
        raise ValueError("At least one field to update must be provided.")
    return body


def _delete_params(ids: Sequence[str], *, delete_associated_prompt: bool) -> httpx.QueryParams:
    params: list[tuple[str, Union[str, int, float, bool, None]]] = [
        ("dataset_evaluator_ids", value) for value in ids
    ]
    params.append(("delete_associated_prompt", "true" if delete_associated_prompt else "false"))
    return httpx.QueryParams(params)


class DatasetEvaluators:
    """Client for bindings between datasets and evaluators.

    A binding registers an evaluator to run against a dataset's experiments. It
    carries its own name and input mapping, and may override the shared
    definition's description and output configurations.

    Examples:
        Basic operations::

            from phoenix.client import Client
            client = Client()

            binding = client.evaluators.dataset_evaluators.create(
                dataset="golden-questions",
                name="exact-match",
                evaluator_id="RXZhbHVhdG9yOjI=",
                input_mapping={"literal_mapping": {}, "path_mapping": {"output": "output"}},
            )

            for item in client.evaluators.dataset_evaluators.list(dataset="golden-questions"):
                print(item["name"], item["evaluator_kind"])

            client.evaluators.dataset_evaluators.delete(
                dataset_evaluator_id=binding["dataset_evaluator_id"]
            )
    """

    def __init__(
        self,
        client: httpx.Client,
        *,
        _guard: ServerVersionGuard | None = None,
    ) -> None:
        """Initialize the DatasetEvaluators client.

        Args:
            client (httpx.Client): The httpx client to use for making requests.
        """
        self._client = client
        self._guard = _guard or ServerVersionGuard(client)

    def create(
        self,
        *,
        dataset: str,
        name: str,
        input_mapping: v1.InputMapping,
        evaluator: Union[DatasetEvaluatorInput, NotGiven] = NOT_GIVEN,
        evaluator_id: Union[str, NotGiven] = NOT_GIVEN,
        description: Union[str, NotGiven] = NOT_GIVEN,
        output_configs: Union[Sequence[EvaluatorOutputConfig], NotGiven] = NOT_GIVEN,
    ) -> v1.DatasetEvaluator:
        """Bind an evaluator to a dataset, creating the evaluator if needed.

        Pass ``evaluator_id`` to bind an existing code or built-in evaluator, or
        ``evaluator`` to create a new LLM or code evaluator and bind it in one
        step. This registers the evaluator and does not run an experiment.

        Args:
            dataset (str): The dataset name or ID.
            name (str): The binding's name, unique within the dataset.
            input_mapping (v1.InputMapping): How example and run fields map onto
                evaluator arguments.
            evaluator (DatasetEvaluatorInput): A new LLM or code evaluator, or a
                ``{"type": "reference", "evaluator_id": ...}`` reference.
            evaluator_id (str): Shorthand for referencing an existing evaluator.
            description (str): Overrides the shared definition's description.
            output_configs (Sequence[EvaluatorOutputConfig]): Overrides the shared
                definition's output configurations.

        Returns:
            The created binding.

        Raises:
            httpx.HTTPError: If the request fails.
            ValueError: If neither or both of evaluator and evaluator_id are given.

        Example::

            from phoenix.client import Client
            client = Client()

            binding = client.evaluators.dataset_evaluators.create(
                dataset="golden-questions",
                name="exact-match",
                evaluator_id="RXZhbHVhdG9yOjI=",
                input_mapping={"literal_mapping": {}, "path_mapping": {"output": "output"}},
            )
        """  # noqa: E501
        json_ = _build_create_body(
            name=name,
            input_mapping=input_mapping,
            evaluator=evaluator,
            evaluator_id=evaluator_id,
            description=description,
            output_configs=output_configs,
        )
        self._guard.require(CREATE_DATASET_EVALUATOR)
        url = f"v1/datasets/{encode_path_param(dataset)}/evaluators"
        response = self._client.post(url, json=json_)
        response.raise_for_status()
        return cast(v1.ResponseBodyDatasetEvaluator, response.json())["data"]

    def list(self, *, dataset: str) -> list[v1.DatasetEvaluator]:
        """List every evaluator bound to a dataset.

        Args:
            dataset (str): The dataset name or ID.

        Returns:
            All bindings on the dataset, following pagination.

        Raises:
            httpx.HTTPError: If the request fails.

        Example::

            from phoenix.client import Client
            client = Client()

            for binding in client.evaluators.dataset_evaluators.list(dataset="golden-questions"):
                print(binding["dataset_evaluator_id"], binding["name"])
        """  # noqa: E501
        self._guard.require(LIST_DATASET_EVALUATORS)
        url = f"v1/datasets/{encode_path_param(dataset)}/evaluators"
        bindings: list[v1.DatasetEvaluator] = []
        next_cursor: Optional[str] = None
        while True:
            params: dict[str, Union[str, int]] = {"limit": _PAGE_SIZE}
            if next_cursor:
                params["cursor"] = next_cursor
            response = self._client.get(url, params=params)
            response.raise_for_status()
            page = cast(v1.PaginatedResponseBodyDatasetEvaluator, response.json())
            bindings.extend(page["data"])
            if not (next_cursor := page.get("next_cursor")):
                break
        return bindings

    def get(self, *, dataset_evaluator_id: str) -> v1.DatasetEvaluator:
        """Get a dataset evaluator binding by ID.

        Args:
            dataset_evaluator_id (str): The binding's ID.

        Returns:
            The binding.

        Raises:
            httpx.HTTPError: If the request fails.
        """
        self._guard.require(GET_DATASET_EVALUATOR)
        url = f"v1/dataset_evaluators/{encode_path_param(dataset_evaluator_id)}"
        response = self._client.get(url)
        response.raise_for_status()
        return cast(v1.ResponseBodyDatasetEvaluator, response.json())["data"]

    def update(
        self,
        *,
        dataset_evaluator_id: str,
        name: Union[str, NotGiven] = NOT_GIVEN,
        input_mapping: Union[v1.InputMapping, NotGiven] = NOT_GIVEN,
        description: Union[str, NotGiven] = NOT_GIVEN,
        output_configs: Union[Sequence[EvaluatorOutputConfig], NotGiven] = NOT_GIVEN,
    ) -> v1.DatasetEvaluator:
        """Update a binding. Omitted fields keep their current values.

        Args:
            dataset_evaluator_id (str): The binding's ID.
            name (str): A new name for the binding.
            input_mapping (v1.InputMapping): A new input mapping.
            description (str): A new description override.
            output_configs (Sequence[EvaluatorOutputConfig]): New output
                configuration overrides.

        Returns:
            The updated binding.

        Raises:
            httpx.HTTPError: If the request fails.
            ValueError: If no field to update is provided.
        """
        json_ = _build_patch_body(
            name=name,
            input_mapping=input_mapping,
            description=description,
            output_configs=output_configs,
        )
        self._guard.require(PATCH_DATASET_EVALUATOR)
        url = f"v1/dataset_evaluators/{encode_path_param(dataset_evaluator_id)}"
        response = self._client.patch(url, json=json_)
        response.raise_for_status()
        return cast(v1.ResponseBodyDatasetEvaluator, response.json())["data"]

    def delete(
        self,
        *,
        dataset_evaluator_id: str,
        delete_associated_prompt: bool = True,
    ) -> None:
        """Delete a binding and its evaluator traces.

        The shared definition is kept while any other project or dataset still
        references it. Missing bindings are ignored.

        Args:
            dataset_evaluator_id (str): The binding's ID.
            delete_associated_prompt (bool): Also delete the prompt of an LLM
                evaluator that becomes unreferenced. Defaults to True.

        Raises:
            httpx.HTTPError: If the request fails.
        """
        self._guard.require(DELETE_DATASET_EVALUATOR)
        url = f"v1/dataset_evaluators/{encode_path_param(dataset_evaluator_id)}"
        response = self._client.delete(
            url,
            params={"delete_associated_prompt": "true" if delete_associated_prompt else "false"},
        )
        response.raise_for_status()

    def delete_many(
        self,
        *,
        dataset_evaluator_ids: Sequence[str],
        delete_associated_prompt: bool = True,
    ) -> None:
        """Delete several bindings atomically.

        Args:
            dataset_evaluator_ids (Sequence[str]): The binding IDs, at most 1000.
            delete_associated_prompt (bool): Also delete the prompts of LLM
                evaluators that become unreferenced. Defaults to True.

        Raises:
            httpx.HTTPError: If the request fails.
            ValueError: If no IDs are given.
        """
        if not dataset_evaluator_ids:
            raise ValueError("At least one dataset_evaluator_id must be provided.")
        self._guard.require(DELETE_DATASET_EVALUATORS)
        response = self._client.delete(
            "v1/dataset_evaluators",
            params=_delete_params(
                dataset_evaluator_ids, delete_associated_prompt=delete_associated_prompt
            ),
        )
        response.raise_for_status()


class AsyncDatasetEvaluators:
    """Asynchronous client for bindings between datasets and evaluators.

    A binding registers an evaluator to run against a dataset's experiments. It
    carries its own name and input mapping, and may override the shared
    definition's description and output configurations.

    Examples:
        Basic operations::

            from phoenix.client import AsyncClient
            client = AsyncClient()

            binding = await client.evaluators.dataset_evaluators.create(
                dataset="golden-questions",
                name="exact-match",
                evaluator_id="RXZhbHVhdG9yOjI=",
                input_mapping={"literal_mapping": {}, "path_mapping": {"output": "output"}},
            )

            for item in await client.evaluators.dataset_evaluators.list(dataset="golden-questions"):
                print(item["name"], item["evaluator_kind"])
    """

    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        _guard: AsyncServerVersionGuard | None = None,
    ) -> None:
        """Initialize the AsyncDatasetEvaluators client.

        Args:
            client (httpx.AsyncClient): The httpx client to use for making requests.
        """
        self._client = client
        self._guard = _guard or AsyncServerVersionGuard(client)

    async def create(
        self,
        *,
        dataset: str,
        name: str,
        input_mapping: v1.InputMapping,
        evaluator: Union[DatasetEvaluatorInput, NotGiven] = NOT_GIVEN,
        evaluator_id: Union[str, NotGiven] = NOT_GIVEN,
        description: Union[str, NotGiven] = NOT_GIVEN,
        output_configs: Union[Sequence[EvaluatorOutputConfig], NotGiven] = NOT_GIVEN,
    ) -> v1.DatasetEvaluator:
        """Bind an evaluator to a dataset, creating the evaluator if needed.

        Pass ``evaluator_id`` to bind an existing code or built-in evaluator, or
        ``evaluator`` to create a new LLM or code evaluator and bind it in one
        step. This registers the evaluator and does not run an experiment.

        Args:
            dataset (str): The dataset name or ID.
            name (str): The binding's name, unique within the dataset.
            input_mapping (v1.InputMapping): How example and run fields map onto
                evaluator arguments.
            evaluator (DatasetEvaluatorInput): A new LLM or code evaluator, or a
                ``{"type": "reference", "evaluator_id": ...}`` reference.
            evaluator_id (str): Shorthand for referencing an existing evaluator.
            description (str): Overrides the shared definition's description.
            output_configs (Sequence[EvaluatorOutputConfig]): Overrides the shared
                definition's output configurations.

        Returns:
            The created binding.

        Raises:
            httpx.HTTPError: If the request fails.
            ValueError: If neither or both of evaluator and evaluator_id are given.
        """
        json_ = _build_create_body(
            name=name,
            input_mapping=input_mapping,
            evaluator=evaluator,
            evaluator_id=evaluator_id,
            description=description,
            output_configs=output_configs,
        )
        await self._guard.require(CREATE_DATASET_EVALUATOR)
        url = f"v1/datasets/{encode_path_param(dataset)}/evaluators"
        response = await self._client.post(url, json=json_)
        response.raise_for_status()
        return cast(v1.ResponseBodyDatasetEvaluator, response.json())["data"]

    async def list(self, *, dataset: str) -> list[v1.DatasetEvaluator]:
        """List every evaluator bound to a dataset.

        Args:
            dataset (str): The dataset name or ID.

        Returns:
            All bindings on the dataset, following pagination.

        Raises:
            httpx.HTTPError: If the request fails.
        """
        await self._guard.require(LIST_DATASET_EVALUATORS)
        url = f"v1/datasets/{encode_path_param(dataset)}/evaluators"
        bindings: list[v1.DatasetEvaluator] = []
        next_cursor: Optional[str] = None
        while True:
            params: dict[str, Union[str, int]] = {"limit": _PAGE_SIZE}
            if next_cursor:
                params["cursor"] = next_cursor
            response = await self._client.get(url, params=params)
            response.raise_for_status()
            page = cast(v1.PaginatedResponseBodyDatasetEvaluator, response.json())
            bindings.extend(page["data"])
            if not (next_cursor := page.get("next_cursor")):
                break
        return bindings

    async def get(self, *, dataset_evaluator_id: str) -> v1.DatasetEvaluator:
        """Get a dataset evaluator binding by ID.

        Args:
            dataset_evaluator_id (str): The binding's ID.

        Returns:
            The binding.

        Raises:
            httpx.HTTPError: If the request fails.
        """
        await self._guard.require(GET_DATASET_EVALUATOR)
        url = f"v1/dataset_evaluators/{encode_path_param(dataset_evaluator_id)}"
        response = await self._client.get(url)
        response.raise_for_status()
        return cast(v1.ResponseBodyDatasetEvaluator, response.json())["data"]

    async def update(
        self,
        *,
        dataset_evaluator_id: str,
        name: Union[str, NotGiven] = NOT_GIVEN,
        input_mapping: Union[v1.InputMapping, NotGiven] = NOT_GIVEN,
        description: Union[str, NotGiven] = NOT_GIVEN,
        output_configs: Union[Sequence[EvaluatorOutputConfig], NotGiven] = NOT_GIVEN,
    ) -> v1.DatasetEvaluator:
        """Update a binding. Omitted fields keep their current values.

        Args:
            dataset_evaluator_id (str): The binding's ID.
            name (str): A new name for the binding.
            input_mapping (v1.InputMapping): A new input mapping.
            description (str): A new description override.
            output_configs (Sequence[EvaluatorOutputConfig]): New output
                configuration overrides.

        Returns:
            The updated binding.

        Raises:
            httpx.HTTPError: If the request fails.
            ValueError: If no field to update is provided.
        """
        json_ = _build_patch_body(
            name=name,
            input_mapping=input_mapping,
            description=description,
            output_configs=output_configs,
        )
        await self._guard.require(PATCH_DATASET_EVALUATOR)
        url = f"v1/dataset_evaluators/{encode_path_param(dataset_evaluator_id)}"
        response = await self._client.patch(url, json=json_)
        response.raise_for_status()
        return cast(v1.ResponseBodyDatasetEvaluator, response.json())["data"]

    async def delete(
        self,
        *,
        dataset_evaluator_id: str,
        delete_associated_prompt: bool = True,
    ) -> None:
        """Delete a binding and its evaluator traces.

        The shared definition is kept while any other project or dataset still
        references it. Missing bindings are ignored.

        Args:
            dataset_evaluator_id (str): The binding's ID.
            delete_associated_prompt (bool): Also delete the prompt of an LLM
                evaluator that becomes unreferenced. Defaults to True.

        Raises:
            httpx.HTTPError: If the request fails.
        """
        await self._guard.require(DELETE_DATASET_EVALUATOR)
        url = f"v1/dataset_evaluators/{encode_path_param(dataset_evaluator_id)}"
        response = await self._client.delete(
            url,
            params={"delete_associated_prompt": "true" if delete_associated_prompt else "false"},
        )
        response.raise_for_status()

    async def delete_many(
        self,
        *,
        dataset_evaluator_ids: Sequence[str],
        delete_associated_prompt: bool = True,
    ) -> None:
        """Delete several bindings atomically.

        Args:
            dataset_evaluator_ids (Sequence[str]): The binding IDs, at most 1000.
            delete_associated_prompt (bool): Also delete the prompts of LLM
                evaluators that become unreferenced. Defaults to True.

        Raises:
            httpx.HTTPError: If the request fails.
            ValueError: If no IDs are given.
        """
        if not dataset_evaluator_ids:
            raise ValueError("At least one dataset_evaluator_id must be provided.")
        await self._guard.require(DELETE_DATASET_EVALUATORS)
        response = await self._client.delete(
            "v1/dataset_evaluators",
            params=_delete_params(
                dataset_evaluator_ids, delete_associated_prompt=delete_associated_prompt
            ),
        )
        response.raise_for_status()

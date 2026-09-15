from __future__ import annotations

from typing import Union

from phoenix.client.__generated__ import v1

__all__ = [
    "DatasetEvaluatorInput",
    "EvaluatorDefinition",
    "EvaluatorOutputConfig",
    "ProjectEvaluatorInput",
]

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
"""An output configuration accepted by code evaluators and bindings."""

DatasetEvaluatorInput = Union[
    v1.NewLLMEvaluator,
    v1.NewCodeEvaluator,
    v1.ExistingDatasetEvaluator,
]
"""The evaluator a dataset binding creates or references. ``type`` is ``"llm"``,
``"code"``, or ``"reference"``."""

ProjectEvaluatorInput = Union[
    v1.NewLLMEvaluator,
    v1.NewCodeEvaluator,
    v1.ExistingCodeEvaluator,
]
"""The evaluator a project binding creates or references. ``type`` is ``"llm"``,
``"code"``, or ``"reference"``."""

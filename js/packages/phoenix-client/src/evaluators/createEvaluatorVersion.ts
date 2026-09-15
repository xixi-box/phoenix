import invariant from "tiny-invariant";

import { createClient } from "../client";
import { CREATE_EVALUATOR_VERSION } from "../constants/serverRequirements";
import type { ClientFn } from "../types/core";
import type { CodeEvaluatorVersion } from "../types/evaluators";
import { ensureServerCapability } from "../utils/serverVersionUtils";

/**
 * Parameters for appending a version to a code evaluator.
 */
export interface CreateEvaluatorVersionParams extends ClientFn {
  /**
   * The GlobalID of the code evaluator.
   */
  evaluatorId: string;
  /**
   * The full source of the new version.
   */
  sourceCode: string;
}

/**
 * Append a new immutable version of a code evaluator's source.
 *
 * If the source matches the current version, the existing version is returned
 * and `was_created` is `false`.
 *
 * @param params - The evaluator and its new source.
 * @param params.evaluatorId - The code evaluator GlobalID.
 * @param params.sourceCode - The full source of the new version.
 * @param params.client - An optional Phoenix client instance.
 * @returns The persisted code version.
 *
 * @requires Phoenix server >= 21.0.0
 *
 * @example
 * ```ts
 * import { readFile } from "node:fs/promises";
 * import { createEvaluatorVersion } from "@arizeai/phoenix-client/evaluators";
 *
 * const version = await createEvaluatorVersion({
 *   evaluatorId: "RXZhbHVhdG9yOjI=",
 *   sourceCode: await readFile("evaluator.py", "utf8"),
 * });
 * console.log(version.evaluator_version_id, version.was_created);
 * ```
 */
export async function createEvaluatorVersion({
  client: _client,
  evaluatorId,
  sourceCode,
}: CreateEvaluatorVersionParams): Promise<CodeEvaluatorVersion> {
  const client = _client ?? createClient();
  await ensureServerCapability({
    client,
    requirement: CREATE_EVALUATOR_VERSION,
  });

  const { data, error } = await client.POST(
    "/v1/evaluators/{evaluator_id}/versions",
    {
      params: { path: { evaluator_id: evaluatorId } },
      body: { source_code: sourceCode },
    }
  );

  if (error) throw error;
  invariant(data?.data, "Failed to create evaluator version");
  return data.data;
}

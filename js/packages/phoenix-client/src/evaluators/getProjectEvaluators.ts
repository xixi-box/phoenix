import invariant from "tiny-invariant";

import type { components } from "../__generated__/api/v1";
import { createClient } from "../client";
import { LIST_PROJECT_EVALUATORS } from "../constants/serverRequirements";
import type { ClientFn } from "../types/core";
import type { ProjectEvaluator } from "../types/evaluators";
import type { ProjectIdentifier } from "../types/projects";
import { resolveProjectIdentifier } from "../types/projects";
import { ensureServerCapability } from "../utils/serverVersionUtils";

/**
 * Parameters for listing the evaluators bound to a project.
 */
export type GetProjectEvaluatorsParams = ClientFn & {
  /**
   * The project, by name or GlobalID.
   */
  project: ProjectIdentifier;
};

type ProjectEvaluatorsPage =
  components["schemas"]["PaginatedResponseBody_ProjectEvaluator_"];

const DEFAULT_PAGE_SIZE = 100;

/**
 * List every evaluator bound to a project. Pagination is handled for you.
 *
 * @param params - The project to list bindings for.
 * @param params.project - The project, by `project`, `projectId`, or `projectName`.
 * @param params.client - An optional Phoenix client instance.
 * @returns All bindings on the project.
 *
 * @requires Phoenix server >= 21.0.0
 *
 * @example
 * ```ts
 * import { getProjectEvaluators } from "@arizeai/phoenix-client/evaluators";
 *
 * const bindings = await getProjectEvaluators({
 *   project: { projectName: "support-bot" },
 * });
 * for (const binding of bindings) {
 *   console.log(binding.name, binding.evaluation_target, binding.enabled);
 * }
 * ```
 */
export async function getProjectEvaluators({
  client: _client,
  project,
}: GetProjectEvaluatorsParams): Promise<ProjectEvaluator[]> {
  const client = _client ?? createClient();
  await ensureServerCapability({
    client,
    requirement: LIST_PROJECT_EVALUATORS,
  });

  const projectIdentifier = resolveProjectIdentifier(project);
  const bindings: ProjectEvaluator[] = [];
  let cursor: string | null | undefined = null;

  do {
    const response: { data?: ProjectEvaluatorsPage; error?: unknown } =
      await client.GET("/v1/projects/{project_identifier}/evaluators", {
        params: {
          path: { project_identifier: projectIdentifier },
          query: { cursor, limit: DEFAULT_PAGE_SIZE },
        },
      });

    if (response.error) throw response.error;
    invariant(response.data?.data, "Failed to list project evaluators");

    cursor = response.data.next_cursor ?? null;
    bindings.push(...response.data.data);
  } while (cursor != null);

  return bindings;
}

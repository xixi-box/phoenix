import { createHttp } from "@arizeai/phoenix-testing";
import { createMockServer, type Server } from "@arizeai/phoenix-testing/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createEvaluatorVersion } from "../../src/evaluators";
import type { CodeEvaluatorVersion } from "../../src/types/evaluators";
import { createTestClient } from "../testUtils";
import { EVALUATOR_ID } from "./evaluatorsTestUtils";

const http = createHttp();

let server: Server;

beforeAll(async () => {
  server = await createMockServer();
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

const SOURCE = "def evaluate(output: str) -> float:\n    return 0.0\n";

describe("createEvaluatorVersion", () => {
  it("POSTs the source and returns the created version", async () => {
    const created: CodeEvaluatorVersion = {
      evaluator_id: EVALUATOR_ID,
      evaluator_version_id: "Q29kZUV2YWx1YXRvclZlcnNpb246Mg==",
      source_code: SOURCE,
      was_created: true,
    };
    let receivedBody: unknown;
    server.use(
      http.post(
        "/v1/evaluators/{evaluator_id}/versions",
        async ({ request, response }) => {
          receivedBody = await request.json();
          return response(201).json({ data: created });
        }
      )
    );

    const version = await createEvaluatorVersion({
      client: createTestClient(),
      evaluatorId: EVALUATOR_ID,
      sourceCode: SOURCE,
    });

    expect(receivedBody).toEqual({ source_code: SOURCE });
    expect(version).toEqual(created);
  });

  it("returns the existing version when the source is unchanged", async () => {
    const existing: CodeEvaluatorVersion = {
      evaluator_id: EVALUATOR_ID,
      evaluator_version_id: "Q29kZUV2YWx1YXRvclZlcnNpb246MQ==",
      source_code: SOURCE,
      was_created: false,
    };
    server.use(
      http.post("/v1/evaluators/{evaluator_id}/versions", ({ response }) =>
        response(200).json({ data: existing })
      )
    );

    const version = await createEvaluatorVersion({
      client: createTestClient(),
      evaluatorId: EVALUATOR_ID,
      sourceCode: SOURCE,
    });

    expect(version.was_created).toBe(false);
  });
});

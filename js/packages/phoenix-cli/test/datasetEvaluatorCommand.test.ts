import type { componentsV1 } from "@arizeai/phoenix-testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ConfirmModule from "../src/confirm";

vi.mock("../src/confirm", async (importOriginal) => {
  const originalModule = await importOriginal<typeof ConfirmModule>();
  return {
    ...originalModule,
    confirmOrExit: vi.fn().mockResolvedValue(undefined),
  };
});

import { createDatasetEvaluatorCommand } from "../src/commands/datasetEvaluator";
import { ENV_PHOENIX_CLI_DANGEROUSLY_ENABLE_DELETES } from "../src/confirm";
import { ExitCode } from "../src/exitCodes";
import { http, setupMockPhoenixServer } from "./mockServer";
import { BASE_ARGS, captureCliOutput, mockProcessExit } from "./testUtils";

const mock = setupMockPhoenixServer();

const BINDING_ID = "RGF0YXNldEV2YWx1YXRvcjox";
const INPUT_MAPPING = {
  literal_mapping: {},
  path_mapping: { output: "output" },
};

const BINDING: componentsV1["schemas"]["DatasetEvaluator"] = {
  dataset_evaluator_id: BINDING_ID,
  dataset_id: "RGF0YXNldDox",
  evaluator_id: "RXZhbHVhdG9yOjI=",
  evaluator_kind: "CODE",
  trace_project_id: "UHJvamVjdDo5",
  name: "exact-match",
  input_mapping: INPUT_MAPPING,
  description: null,
  output_configs: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dataset evaluator list", () => {
  it("GETs the dataset's bindings by identifier and prints them as raw JSON", async () => {
    let receivedIdentifier: string | undefined;
    mock.server.use(
      http.get(
        "/v1/datasets/{dataset_identifier}/evaluators",
        ({ params, response }) => {
          receivedIdentifier = params.dataset_identifier;
          return response(200).json({ data: [BINDING], next_cursor: null });
        }
      )
    );
    const io = captureCliOutput();

    await createDatasetEvaluatorCommand().parseAsync(
      ["list", "golden-questions", "--format", "raw", ...BASE_ARGS],
      { from: "user" }
    );

    expect(receivedIdentifier).toBe("golden-questions");
    const parsed = JSON.parse(String(io.stdout.mock.calls[0]?.[0]));
    expect(parsed).toEqual([BINDING]);
  });
});

describe("dataset evaluator create", () => {
  function captureCreate() {
    const captured: { identifier?: string; body?: unknown; count: number } = {
      count: 0,
    };
    mock.server.use(
      http.post(
        "/v1/datasets/{dataset_identifier}/evaluators",
        async ({ params, request, response }) => {
          captured.count += 1;
          captured.identifier = params.dataset_identifier;
          captured.body = await request.clone().json();
          return response(201).json({ data: BINDING });
        }
      )
    );
    return captured;
  }

  it("builds a reference body from --evaluator-id", async () => {
    const captured = captureCreate();
    const io = captureCliOutput();

    await createDatasetEvaluatorCommand().parseAsync(
      [
        "create",
        "golden-questions",
        "--name",
        "exact-match",
        "--evaluator-id",
        "RXZhbHVhdG9yOjI=",
        "--input-mapping",
        JSON.stringify(INPUT_MAPPING),
        "--format",
        "raw",
        ...BASE_ARGS,
      ],
      { from: "user" }
    );

    expect(captured.count).toBe(1);
    expect(captured.identifier).toBe("golden-questions");
    expect(captured.body).toEqual({
      name: "exact-match",
      input_mapping: INPUT_MAPPING,
      evaluator: { type: "reference", evaluator_id: "RXZhbHVhdG9yOjI=" },
    });
    const parsed = JSON.parse(String(io.stdout.mock.calls[0]?.[0]));
    expect(parsed).toEqual(BINDING);
  });

  it("passes an inline --evaluator and overrides through", async () => {
    const captured = captureCreate();
    captureCliOutput();
    const evaluator = {
      type: "code",
      source_code: "def evaluate(output: str) -> float:\n    return 1.0\n",
      language: "PYTHON",
      sandbox_config_id: "U2FuZGJveENvbmZpZzox",
      input_mapping: INPUT_MAPPING,
    };

    await createDatasetEvaluatorCommand().parseAsync(
      [
        "create",
        "golden-questions",
        "--name",
        "exact-match",
        "--evaluator",
        JSON.stringify(evaluator),
        "--input-mapping",
        JSON.stringify(INPUT_MAPPING),
        "--description",
        "override",
        "--output-configs",
        '[{"type":"FREEFORM","name":"notes"}]',
        ...BASE_ARGS,
      ],
      { from: "user" }
    );

    expect(captured.body).toEqual({
      name: "exact-match",
      input_mapping: INPUT_MAPPING,
      evaluator,
      description: "override",
      output_configs: [{ type: "FREEFORM", name: "notes" }],
    });
  });

  it("exits INVALID_ARGUMENT without an evaluator source and never calls the server", async () => {
    const captured = captureCreate();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = mockProcessExit();

    await expect(
      createDatasetEvaluatorCommand().parseAsync(
        [
          "create",
          "golden-questions",
          "--name",
          "exact-match",
          "--input-mapping",
          JSON.stringify(INPUT_MAPPING),
          ...BASE_ARGS,
        ],
        { from: "user" }
      )
    ).rejects.toThrow(`process.exit:${ExitCode.INVALID_ARGUMENT}`);

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_ARGUMENT);
    expect(captured.count).toBe(0);
  });
});

describe("dataset evaluator update", () => {
  it("PATCHes only the flags given", async () => {
    let receivedBody: unknown;
    mock.server.use(
      http.patch(
        "/v1/dataset_evaluators/{dataset_evaluator_id}",
        async ({ request, response }) => {
          receivedBody = await request.clone().json();
          return response(200).json({ data: { ...BINDING, name: "renamed" } });
        }
      )
    );
    captureCliOutput();

    await createDatasetEvaluatorCommand().parseAsync(
      ["update", BINDING_ID, "--name", "renamed", ...BASE_ARGS],
      { from: "user" }
    );

    expect(receivedBody).toEqual({ name: "renamed" });
  });

  it("exits INVALID_ARGUMENT when no field flag is given", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = mockProcessExit();

    await expect(
      createDatasetEvaluatorCommand().parseAsync(
        ["update", BINDING_ID, ...BASE_ARGS],
        { from: "user" }
      )
    ).rejects.toThrow(`process.exit:${ExitCode.INVALID_ARGUMENT}`);

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_ARGUMENT);
  });
});

describe("dataset evaluator delete", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env[ENV_PHOENIX_CLI_DANGEROUSLY_ENABLE_DELETES];
    process.env[ENV_PHOENIX_CLI_DANGEROUSLY_ENABLE_DELETES] = "true";
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[ENV_PHOENIX_CLI_DANGEROUSLY_ENABLE_DELETES];
    } else {
      process.env[ENV_PHOENIX_CLI_DANGEROUSLY_ENABLE_DELETES] = originalEnv;
    }
  });

  it("DELETEs a single binding and forwards --keep-prompt", async () => {
    let receivedId: string | undefined;
    let receivedFlag: string | null = null;
    mock.server.use(
      http.delete(
        "/v1/dataset_evaluators/{dataset_evaluator_id}",
        ({ params, request, response }) => {
          receivedId = params.dataset_evaluator_id;
          receivedFlag = new URL(request.url).searchParams.get(
            "delete_associated_prompt"
          );
          return response(204).empty();
        }
      )
    );
    captureCliOutput();

    await createDatasetEvaluatorCommand().parseAsync(
      ["delete", BINDING_ID, "--keep-prompt", "--yes", ...BASE_ARGS],
      { from: "user" }
    );

    expect(receivedId).toBe(BINDING_ID);
    expect(receivedFlag).toBe("false");
  });

  it("uses the bulk endpoint for several ids", async () => {
    let receivedIds: string[] = [];
    mock.server.use(
      http.delete("/v1/dataset_evaluators", ({ request, response }) => {
        receivedIds = new URL(request.url).searchParams.getAll(
          "dataset_evaluator_ids"
        );
        return response(204).empty();
      })
    );
    captureCliOutput();

    await createDatasetEvaluatorCommand().parseAsync(
      ["delete", "a", "b", "--yes", ...BASE_ARGS],
      { from: "user" }
    );

    expect(receivedIds).toEqual(["a", "b"]);
  });

  it("exits INVALID_ARGUMENT when deletes are not enabled", async () => {
    delete process.env[ENV_PHOENIX_CLI_DANGEROUSLY_ENABLE_DELETES];
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = mockProcessExit();

    await expect(
      createDatasetEvaluatorCommand().parseAsync(
        ["delete", BINDING_ID, "--yes", ...BASE_ARGS],
        { from: "user" }
      )
    ).rejects.toThrow(`process.exit:${ExitCode.INVALID_ARGUMENT}`);

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_ARGUMENT);
  });
});

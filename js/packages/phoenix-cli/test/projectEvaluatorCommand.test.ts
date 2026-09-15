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

import { createProjectEvaluatorCommand } from "../src/commands/projectEvaluator";
import { ENV_PHOENIX_CLI_DANGEROUSLY_ENABLE_DELETES } from "../src/confirm";
import { ExitCode } from "../src/exitCodes";
import { http, setupMockPhoenixServer } from "./mockServer";
import { BASE_ARGS, captureCliOutput, mockProcessExit } from "./testUtils";

const mock = setupMockPhoenixServer();

const BINDING_ID = "UHJvamVjdEV2YWx1YXRvcjox";

const BINDING: componentsV1["schemas"]["ProjectEvaluator"] = {
  project_evaluator_id: BINDING_ID,
  project_id: "UHJvamVjdDox",
  evaluator_id: "RXZhbHVhdG9yOjE=",
  evaluator_kind: "LLM",
  trace_project_id: "UHJvamVjdDo5",
  name: "toxicity",
  evaluation_target: "SPAN",
  sampling_rate: 0.25,
  filter_condition: "",
  enabled: true,
  input_mapping: null,
  evaluation_delay_seconds: 300,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("project evaluator list", () => {
  it("GETs the project's bindings by identifier and prints them as raw JSON", async () => {
    let receivedIdentifier: string | undefined;
    mock.server.use(
      http.get(
        "/v1/projects/{project_identifier}/evaluators",
        ({ params, response }) => {
          receivedIdentifier = params.project_identifier;
          return response(200).json({ data: [BINDING], next_cursor: null });
        }
      )
    );
    const io = captureCliOutput();

    await createProjectEvaluatorCommand().parseAsync(
      ["list", "support-bot", "--format", "raw", ...BASE_ARGS],
      { from: "user" }
    );

    expect(receivedIdentifier).toBe("support-bot");
    const parsed = JSON.parse(String(io.stdout.mock.calls[0]?.[0]));
    expect(parsed).toEqual([BINDING]);
  });
});

describe("project evaluator create", () => {
  function captureCreate() {
    const captured: { identifier?: string; body?: unknown; count: number } = {
      count: 0,
    };
    mock.server.use(
      http.post(
        "/v1/projects/{project_identifier}/evaluators",
        async ({ params, request, response }) => {
          captured.count += 1;
          captured.identifier = params.project_identifier;
          captured.body = await request.clone().json();
          return response(201).json({ data: BINDING });
        }
      )
    );
    return captured;
  }

  it("builds the request from scheduling flags and --evaluator-id", async () => {
    const captured = captureCreate();
    const io = captureCliOutput();

    await createProjectEvaluatorCommand().parseAsync(
      [
        "create",
        "support-bot",
        "--name",
        "toxicity",
        "--evaluation-target",
        "span",
        "--sampling-rate",
        "0.25",
        "--evaluator-id",
        "RXZhbHVhdG9yOjE=",
        "--filter-condition",
        "span_kind == 'LLM'",
        "--disabled",
        "--format",
        "raw",
        ...BASE_ARGS,
      ],
      { from: "user" }
    );

    expect(captured.count).toBe(1);
    expect(captured.identifier).toBe("support-bot");
    expect(captured.body).toEqual({
      name: "toxicity",
      evaluation_target: "SPAN",
      sampling_rate: 0.25,
      evaluator: { type: "reference", evaluator_id: "RXZhbHVhdG9yOjE=" },
      filter_condition: "span_kind == 'LLM'",
      enabled: false,
    });
    const parsed = JSON.parse(String(io.stdout.mock.calls[0]?.[0]));
    expect(parsed).toEqual(BINDING);
  });

  it("forwards a session delay and inline evaluator JSON", async () => {
    const captured = captureCreate();
    captureCliOutput();
    const evaluator = {
      type: "code",
      source_code: "def evaluate(output: str) -> float:\n    return 1.0\n",
      language: "PYTHON",
      sandbox_config_id: "U2FuZGJveENvbmZpZzox",
      input_mapping: { literal_mapping: {}, path_mapping: {} },
    };

    await createProjectEvaluatorCommand().parseAsync(
      [
        "create",
        "support-bot",
        "--name",
        "resolution",
        "--evaluation-target",
        "SESSION",
        "--sampling-rate",
        "1",
        "--evaluator",
        JSON.stringify(evaluator),
        "--evaluation-delay-seconds",
        "600",
        ...BASE_ARGS,
      ],
      { from: "user" }
    );

    expect(captured.body).toEqual({
      name: "resolution",
      evaluation_target: "SESSION",
      sampling_rate: 1,
      evaluator,
      evaluation_delay_seconds: 600,
    });
  });

  it("exits INVALID_ARGUMENT on an unknown --evaluation-target without calling the server", async () => {
    const captured = captureCreate();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = mockProcessExit();

    await expect(
      createProjectEvaluatorCommand().parseAsync(
        [
          "create",
          "support-bot",
          "--name",
          "toxicity",
          "--evaluation-target",
          "DOCUMENT",
          "--sampling-rate",
          "1",
          "--evaluator-id",
          "RXZhbHVhdG9yOjE=",
          ...BASE_ARGS,
        ],
        { from: "user" }
      )
    ).rejects.toThrow(`process.exit:${ExitCode.INVALID_ARGUMENT}`);

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_ARGUMENT);
    expect(captured.count).toBe(0);
  });

  it("exits INVALID_ARGUMENT without --sampling-rate", async () => {
    const captured = captureCreate();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = mockProcessExit();

    await expect(
      createProjectEvaluatorCommand().parseAsync(
        [
          "create",
          "support-bot",
          "--name",
          "toxicity",
          "--evaluation-target",
          "SPAN",
          "--evaluator-id",
          "RXZhbHVhdG9yOjE=",
          ...BASE_ARGS,
        ],
        { from: "user" }
      )
    ).rejects.toThrow(`process.exit:${ExitCode.INVALID_ARGUMENT}`);

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_ARGUMENT);
    expect(captured.count).toBe(0);
  });
});

describe("project evaluator update", () => {
  function capturePatch() {
    const captured: { body?: unknown; count: number } = { count: 0 };
    mock.server.use(
      http.patch(
        "/v1/project_evaluators/{project_evaluator_id}",
        async ({ request, response }) => {
          captured.count += 1;
          captured.body = await request.clone().json();
          return response(200).json({ data: { ...BINDING, enabled: false } });
        }
      )
    );
    return captured;
  }

  it("PATCHes only the flags given, collapsing --disabled to enabled:false", async () => {
    const captured = capturePatch();
    captureCliOutput();

    await createProjectEvaluatorCommand().parseAsync(
      [
        "update",
        BINDING_ID,
        "--disabled",
        "--sampling-rate",
        "0.5",
        ...BASE_ARGS,
      ],
      { from: "user" }
    );

    expect(captured.body).toEqual({ sampling_rate: 0.5, enabled: false });
  });

  it("rejects --enabled together with --disabled", async () => {
    const captured = capturePatch();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = mockProcessExit();

    await expect(
      createProjectEvaluatorCommand().parseAsync(
        ["update", BINDING_ID, "--enabled", "--disabled", ...BASE_ARGS],
        { from: "user" }
      )
    ).rejects.toThrow(`process.exit:${ExitCode.INVALID_ARGUMENT}`);

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_ARGUMENT);
    expect(captured.count).toBe(0);
  });

  it("exits INVALID_ARGUMENT when no field flag is given", async () => {
    const captured = capturePatch();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = mockProcessExit();

    await expect(
      createProjectEvaluatorCommand().parseAsync(
        ["update", BINDING_ID, ...BASE_ARGS],
        { from: "user" }
      )
    ).rejects.toThrow(`process.exit:${ExitCode.INVALID_ARGUMENT}`);

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_ARGUMENT);
    expect(captured.count).toBe(0);
  });
});

describe("project evaluator delete", () => {
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
        "/v1/project_evaluators/{project_evaluator_id}",
        ({ params, request, response }) => {
          receivedId = params.project_evaluator_id;
          receivedFlag = new URL(request.url).searchParams.get(
            "delete_associated_prompt"
          );
          return response(204).empty();
        }
      )
    );
    captureCliOutput();

    await createProjectEvaluatorCommand().parseAsync(
      ["delete", BINDING_ID, "--keep-prompt", "--yes", ...BASE_ARGS],
      { from: "user" }
    );

    expect(receivedId).toBe(BINDING_ID);
    expect(receivedFlag).toBe("false");
  });

  it("uses the bulk endpoint for several ids", async () => {
    let receivedIds: string[] = [];
    mock.server.use(
      http.delete("/v1/project_evaluators", ({ request, response }) => {
        receivedIds = new URL(request.url).searchParams.getAll(
          "project_evaluator_ids"
        );
        return response(204).empty();
      })
    );
    captureCliOutput();

    await createProjectEvaluatorCommand().parseAsync(
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
      createProjectEvaluatorCommand().parseAsync(
        ["delete", BINDING_ID, "--yes", ...BASE_ARGS],
        { from: "user" }
      )
    ).rejects.toThrow(`process.exit:${ExitCode.INVALID_ARGUMENT}`);

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_ARGUMENT);
  });
});

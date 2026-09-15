import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { componentsV1 } from "@arizeai/phoenix-testing";
import { HttpResponse } from "@arizeai/phoenix-testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEvaluatorCommand } from "../src/commands/evaluator";
import { ExitCode } from "../src/exitCodes";
import { http, setupMockPhoenixServer } from "./mockServer";
import { BASE_ARGS, captureCliOutput, mockProcessExit } from "./testUtils";

const mock = setupMockPhoenixServer();

const EVALUATOR_ID = "RXZhbHVhdG9yOjE=";

const CODE_EVALUATOR: componentsV1["schemas"]["CodeEvaluatorDefinition"] = {
  type: "code",
  evaluator_id: EVALUATOR_ID,
  name: "exact-match",
  description: null,
  language: "PYTHON",
  sandbox_config_id: "U2FuZGJveENvbmZpZzox",
  input_mapping: { literal_mapping: {}, path_mapping: { output: "output" } },
  output_configs: [],
  evaluator_version_id: "Q29kZUV2YWx1YXRvclZlcnNpb246MQ==",
  source_code: "def evaluate(output: str) -> float:\n    return 1.0\n",
};

const LLM_EVALUATOR: componentsV1["schemas"]["LLMEvaluatorDefinition"] = {
  type: "llm",
  evaluator_id: EVALUATOR_ID,
  name: "toxicity",
  description: "Flags toxic responses",
  prompt_version: null,
  output_configs: [
    {
      type: "CATEGORICAL",
      name: "toxicity",
      optimization_direction: "MINIMIZE",
      values: [
        { label: "toxic", score: 1 },
        { label: "clean", score: 0 },
      ],
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

function capturePatch() {
  const captured: { id?: string; body?: unknown; count: number } = {
    count: 0,
  };
  mock.server.use(
    http.patch(
      "/v1/evaluators/{evaluator_id}",
      async ({ params, request, response }) => {
        captured.count += 1;
        captured.id = params.evaluator_id;
        captured.body = await request.clone().json();
        return response(200).json({ data: LLM_EVALUATOR });
      }
    )
  );
  return captured;
}

describe("evaluator get", () => {
  it("GETs by id and prints the definition as raw JSON", async () => {
    let receivedId: string | undefined;
    mock.server.use(
      http.get("/v1/evaluators/{evaluator_id}", ({ params, response }) => {
        receivedId = params.evaluator_id;
        return response(200).json({ data: CODE_EVALUATOR });
      })
    );
    const io = captureCliOutput();

    await createEvaluatorCommand().parseAsync(
      ["get", EVALUATOR_ID, "--format", "raw", ...BASE_ARGS],
      { from: "user" }
    );

    expect(receivedId).toBe(EVALUATOR_ID);
    const parsed = JSON.parse(String(io.stdout.mock.calls[0]?.[0]));
    expect(parsed).toEqual(CODE_EVALUATOR);
  });

  it("exits FAILURE when the evaluator is not found", async () => {
    mock.server.use(
      http.get("/v1/evaluators/{evaluator_id}", ({ response }) =>
        response.untyped(HttpResponse.text("not found", { status: 404 }))
      )
    );
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = mockProcessExit();

    await expect(
      createEvaluatorCommand().parseAsync(
        ["get", "missing", "--format", "raw", ...BASE_ARGS],
        { from: "user" }
      )
    ).rejects.toThrow(`process.exit:${ExitCode.FAILURE}`);

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.FAILURE);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error fetching evaluator")
    );
  });
});

describe("evaluator update", () => {
  it("PATCHes only the flags given, discriminated by --type", async () => {
    const captured = capturePatch();
    const io = captureCliOutput();

    await createEvaluatorCommand().parseAsync(
      [
        "update",
        EVALUATOR_ID,
        "--type",
        "llm",
        "--description",
        "Flags toxic responses",
        "--format",
        "raw",
        ...BASE_ARGS,
      ],
      { from: "user" }
    );

    expect(captured.count).toBe(1);
    expect(captured.id).toBe(EVALUATOR_ID);
    expect(captured.body).toEqual({
      type: "llm",
      description: "Flags toxic responses",
    });
    const parsed = JSON.parse(String(io.stdout.mock.calls[0]?.[0]));
    expect(parsed).toEqual(LLM_EVALUATOR);
  });

  it("parses JSON flags into the code patch", async () => {
    const captured = capturePatch();
    captureCliOutput();

    await createEvaluatorCommand().parseAsync(
      [
        "update",
        EVALUATOR_ID,
        "--type",
        "code",
        "--input-mapping",
        '{"literal_mapping":{},"path_mapping":{"output":"output.text"}}',
        "--output-configs",
        '[{"type":"FREEFORM","name":"notes"}]',
        "--format",
        "raw",
        ...BASE_ARGS,
      ],
      { from: "user" }
    );

    expect(captured.body).toEqual({
      type: "code",
      input_mapping: {
        literal_mapping: {},
        path_mapping: { output: "output.text" },
      },
      output_configs: [{ type: "FREEFORM", name: "notes" }],
    });
  });

  it("exits INVALID_ARGUMENT without --type and never calls the server", async () => {
    const captured = capturePatch();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = mockProcessExit();

    await expect(
      createEvaluatorCommand().parseAsync(
        ["update", EVALUATOR_ID, "--name", "x", ...BASE_ARGS],
        { from: "user" }
      )
    ).rejects.toThrow(`process.exit:${ExitCode.INVALID_ARGUMENT}`);

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_ARGUMENT);
    expect(captured.count).toBe(0);
  });

  it("rejects code-only flags on an llm update", async () => {
    const captured = capturePatch();
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = mockProcessExit();

    await expect(
      createEvaluatorCommand().parseAsync(
        [
          "update",
          EVALUATOR_ID,
          "--type",
          "llm",
          "--sandbox-config-id",
          "abc",
          ...BASE_ARGS,
        ],
        { from: "user" }
      )
    ).rejects.toThrow(`process.exit:${ExitCode.INVALID_ARGUMENT}`);

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_ARGUMENT);
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "--sandbox-config-id cannot be used with --type llm"
      )
    );
    expect(captured.count).toBe(0);
  });

  it("exits INVALID_ARGUMENT when no field flag is given", async () => {
    const captured = capturePatch();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = mockProcessExit();

    await expect(
      createEvaluatorCommand().parseAsync(
        ["update", EVALUATOR_ID, "--type", "code", ...BASE_ARGS],
        { from: "user" }
      )
    ).rejects.toThrow(`process.exit:${ExitCode.INVALID_ARGUMENT}`);

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_ARGUMENT);
    expect(captured.count).toBe(0);
  });
});

describe("evaluator version create", () => {
  it("POSTs the file contents and prints the version", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "px-evaluator-"));
    const file = path.join(dir, "evaluator.py");
    const source = "def evaluate(output: str) -> float:\n    return 0.5\n";
    fs.writeFileSync(file, source);
    const version: componentsV1["schemas"]["CodeEvaluatorVersion"] = {
      evaluator_id: EVALUATOR_ID,
      evaluator_version_id: "Q29kZUV2YWx1YXRvclZlcnNpb246Mg==",
      source_code: source,
      was_created: true,
    };
    let receivedBody: unknown;
    mock.server.use(
      http.post(
        "/v1/evaluators/{evaluator_id}/versions",
        async ({ request, response }) => {
          receivedBody = await request.clone().json();
          return response(201).json({ data: version });
        }
      )
    );
    const io = captureCliOutput();

    try {
      await createEvaluatorCommand().parseAsync(
        [
          "version",
          "create",
          EVALUATOR_ID,
          "--file",
          file,
          "--format",
          "raw",
          ...BASE_ARGS,
        ],
        { from: "user" }
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    expect(receivedBody).toEqual({ source_code: source });
    const parsed = JSON.parse(String(io.stdout.mock.calls[0]?.[0]));
    expect(parsed).toEqual(version);
  });

  it("exits INVALID_ARGUMENT when neither --source-code nor --file is given", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = mockProcessExit();

    await expect(
      createEvaluatorCommand().parseAsync(
        ["version", "create", EVALUATOR_ID, ...BASE_ARGS],
        { from: "user" }
      )
    ).rejects.toThrow(`process.exit:${ExitCode.INVALID_ARGUMENT}`);

    expect(exitSpy).toHaveBeenCalledWith(ExitCode.INVALID_ARGUMENT);
  });
});

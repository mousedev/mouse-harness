import { describe, expect, it } from "vitest";
import { classifyInferenceFailure } from "../src/failures.js";

describe("classifyInferenceFailure", () => {
  it("separates transient, model-route, and other failures", () => {
    expect(classifyInferenceFailure("429 Too Many Requests")).toBe("transient");
    expect(classifyInferenceFailure("", { message: "provider overloaded" })).toBe("transient");
    expect(classifyInferenceFailure("model_not_found: kimi-k9")).toBe("model_route");
    expect(classifyInferenceFailure("invalid api key")).toBe("other");
  });
});

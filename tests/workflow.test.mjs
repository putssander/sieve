import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCost } from "../site/js/workflow.js";

test("batch planning accounts for both token rates and repeat runs", () => {
  assert.equal(estimateCost({ papers: 100, runs: 2, inputTokens: 2000, outputTokens: 300, inputRate: 3, outputRate: 15 }), 2.1);
});

test("missing or invalid rates never appear as a free batch", () => {
  const input = { papers: "100", runs: "1", inputTokens: "2000", outputTokens: "300", inputRate: "3", outputRate: "15" };
  assert.equal(estimateCost(input), 1.05);
  for (const value of ["", null, undefined, "bad", -1, Infinity]) {
    assert.equal(estimateCost({ ...input, inputRate: value }), null);
  }
  assert.equal(estimateCost({ ...input, inputRate: 0, outputRate: 0 }), 0);
  assert.equal(estimateCost({ ...input, papers: 0 }), 0);
});

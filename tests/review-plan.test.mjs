import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyProject, normalize } from "../site/js/store.js";
import { applyReviewPlan, changeFramework, suggestedType } from "../site/js/review-plan.js";

test("a question and mapping purpose become a scoping project with a PCC framework", () => {
  const p = emptyProject("My question");
  applyReviewPlan(p.protocol, { question: "  How are writing groups studied?  ", purpose: "map", type: suggestedType("map") });
  const restored = normalize(JSON.parse(JSON.stringify(p)));
  assert.equal(restored.protocol.question, "How are writing groups studied?");
  assert.equal(restored.protocol.purpose, "map");
  assert.equal(restored.protocol.review_type, "scoping");
  assert.equal(restored.protocol.framework, "PCC");
  assert.equal(restored.protocol.maintenance, "one-off");
});

test("changing frameworks preserves each draft and never treats comparison as concept", () => {
  const p = emptyProject().protocol;
  p.elements.find(e => e.key === "P").text = "Doctoral students";
  p.elements.find(e => e.key === "C").text = "Working alone";
  changeFramework(p, "PCC");
  assert.equal(p.elements.find(e => e.key === "P").text, "Doctoral students");
  assert.equal(p.elements.find(e => e.key === "C").text, "");
  p.elements.find(e => e.key === "C").text = "Writing groups";
  p.elements.find(e => e.key === "P").text = "";
  changeFramework(p, "Open");
  assert.deepEqual(p.elements, []);
  changeFramework(p, "PICO");
  assert.equal(p.elements.find(e => e.key === "C").text, "Working alone");
  changeFramework(p, "PCC");
  assert.equal(p.elements.find(e => e.key === "C").text, "Writing groups");
  assert.equal(p.elements.find(e => e.key === "P").text, "");
});

test("an ongoing update retains its underlying review type and existing protocol work", () => {
  const p = emptyProject().protocol;
  p.notes = "Agreed with the team";
  p.documents = [{ name: "protocol.txt", text: "Original plan" }];
  applyReviewPlan(p, { question: "What new evidence exists?", purpose: "update", type: "scoping", maintenance: "living" });
  assert.equal(p.review_type, "scoping");
  assert.equal(p.maintenance, "living");
  assert.equal(p.notes, "Agreed with the team");
  assert.equal(p.documents.length, 1);
  assert.throws(() => applyReviewPlan(p, { type: "unknown" }), /Choose a review type/);
});

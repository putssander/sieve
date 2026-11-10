import { h, toast } from "../util.js";
import { btn, field, textarea, select } from "../ui.js";
import { stageIcon } from "../icons.js";
import { disclosure } from "../disclosure.js";
import { PURPOSES, REVIEW_TYPES, QUESTION_EXAMPLES, suggestedType } from "../review-plan.js";

export function reviewStarter({ initial = {}, home = false, resumeHref = "", walkthrough = null, onChange = () => {}, onStart } = {}) {
  const first = QUESTION_EXAMPLES[0];
  const initialIndex = QUESTION_EXAMPLES.findIndex(e => e.id === initial.exampleId || e.question === initial.question);
  let index = Math.max(0, initialIndex), edited = false, timer = null, destroyed = false;
  let progressAnimation = null, transitionAnimations = [], ghost = null;
  let compareOpen = false;
  const DWELL = 6000;
  const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
  let playing = home && !reducedMotion;
  const draft = { question: initial.question || (home ? first.question : ""), purpose: initial.purpose || (home ? first.purpose : ""),
    type: initial.type || (home ? first.type : "systematic"), maintenance: initial.maintenance || "update", exampleId: initial.exampleId || (home ? first.id : null),
    framework: initial.framework || REVIEW_TYPES[initial.type || first.type]?.framework };
  const root = h("section", { class: home ? "question-first" : "protocol-start", "aria-label": "Question and purpose" });
  const purposeHost = h("div", { class: "purpose-grid" });
  const planHost = h("div", { class: "review-plan-host", "aria-live": "off" });
  planHost.addEventListener("focusin", () => pause());
  const exampleLabel = h("span", { class: "question-example-label" });
  const exampleCount = h("span", { class: "example-count", "aria-hidden": "true" });
  const question = textarea(draft.question, value => {
    edited = true; pause(); stopTransition(); draft.question = value; draft.exampleId = null;
    exampleLabel.textContent = "Your question. Your next discovery.";
    onChange({ ...draft }, "question");
  }, { rows: home ? 4 : 3, required: true, placeholder: "What do you want to find out?", "aria-label": "Your review question" });
  question.addEventListener("focus", () => { pause(); stopTransition(); });
  const questionStage = h("div", { class: "question-text-stage" }, question);
  const playback = btn("", () => {
    if (playing) pause(); else { playing = true; edited = false; updatePlayback(); schedule(); }
  }, "example-control");
  function updatePlayback() {
    root.classList.toggle("examples-playing", playing);
    playback.replaceChildren(stageIcon(playing ? "pause" : "play"));
    playback.setAttribute("aria-label", playing ? "Pause example rotation" : "Play example rotation");
    playback.title = playing ? "Pause examples" : "Play examples (replaces the example question)";
    playback.setAttribute("aria-pressed", String(playing));
  }
  function pause() { playing = false; clearTimeout(timer); progressAnimation?.pause(); updatePlayback(); }
  function stopTransition() {
    transitionAnimations.forEach(a => a.cancel()); transitionAnimations = [];
    ghost?.remove(); ghost = null;
  }
  function schedule() {
    clearTimeout(timer);
    progressAnimation?.cancel(); progressAnimation = null;
    if (!home || !playing || destroyed || document.hidden) return;
    const fill = indicatorButtons[index].querySelector(".example-indicator-fill");
    if (!reducedMotion && fill.animate) progressAnimation = fill.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: DWELL, easing: "linear", fill: "forwards" });
    timer = setTimeout(() => {
      if (!root.isConnected) { destroy(); return; }
      if (playing) chooseExample(index + 1, true);
      schedule();
    }, DWELL);
  }
  function visibilityChanged() {
    if (document.hidden) { clearTimeout(timer); progressAnimation?.pause(); }
    else if (playing) schedule();
  }
  function destroy() {
    destroyed = true; clearTimeout(timer); progressAnimation?.cancel(); stopTransition();
    document.removeEventListener("visibilitychange", visibilityChanged);
  }
  function chooseExample(next, automatic = false) {
    const active = document.activeElement;
    if (automatic && (edited || (root.contains(active) && active?.matches("input, textarea, select")) || document.hidden)) return;
    const previous = question.value;
    const direction = next < index ? -1 : 1;
    stopTransition();
    index = (next + QUESTION_EXAMPLES.length) % QUESTION_EXAMPLES.length;
    const e = QUESTION_EXAMPLES[index];
    Object.assign(draft, { question: e.question, purpose: e.purpose, type: e.type, framework: REVIEW_TYPES[e.type].framework, exampleId: e.id, maintenance: "update" });
    question.value = e.question;
    edited = false;
    exampleLabel.textContent = e.name;
    updateIndicators();
    if (!reducedMotion && question.animate && previous !== e.question) {
      ghost = h("div", { class: "question-transition-ghost", "aria-hidden": "true" }, previous);
      questionStage.append(ghost);
      const outgoing = ghost.animate([
        { opacity: 1, transform: "translateY(0) rotateX(0deg)", filter: "blur(0)" },
        { opacity: 0, transform: `translateY(${-38 * direction}px) rotateX(${12 * direction}deg)`, filter: "blur(7px)" },
      ], { duration: 550, easing: "cubic-bezier(.22,1,.36,1)", fill: "forwards" });
      const incoming = question.animate([
        { opacity: 0, transform: `translateY(${42 * direction}px) rotateX(${-10 * direction}deg)`, filter: "blur(7px)", offset: 0 },
        { opacity: 0, offset: .14 },
        { opacity: 1, transform: "translateY(0) rotateX(0deg)", filter: "blur(0)", offset: 1 },
      ], { duration: 950, easing: "cubic-bezier(.16,1,.3,1)" });
      transitionAnimations = [outgoing, incoming, exampleLabel.animate([
        { opacity: 0, transform: "translateX(12px)" }, { opacity: 1, transform: "translateX(0)" },
      ], { duration: 600, easing: "ease-out" })];
      const old = ghost;
      outgoing.finished.then(() => { old.remove(); if (ghost === old) ghost = null; }).catch(() => {});
    }
    drawPurpose(); drawPlan();
    onChange({ ...draft }, "example");
  }

  const indicatorButtons = QUESTION_EXAMPLES.map((e, n) => h("button", { type: "button", class: "example-indicator", "aria-label": `Show example ${n + 1}: ${e.name}`, title: e.name,
    onclick: () => { pause(); chooseExample(n); } }, h("span", { class: "example-indicator-track", "aria-hidden": "true" }, h("span", { class: "example-indicator-fill" }))));
  const indicators = h("nav", { class: "example-indicators", "aria-label": "Example questions" }, indicatorButtons);
  function updateIndicators() {
    indicatorButtons.forEach((b, n) => {
      b.classList.toggle("current", n === index);
      if (n === index) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    });
    exampleCount.textContent = `${String(index + 1).padStart(2, "0")} / ${String(QUESTION_EXAMPLES.length).padStart(2, "0")}`;
  }
  const questionCard = h("div", { class: "question-card" },
    h("div", { class: "question-card-top" }, h("span", { class: "question-topic" }, h("span", { class: "question-topic-kicker" }, "One question can change your direction"), exampleLabel), exampleCount),
    h("span", { class: "question-quote", "aria-hidden": "true" }, "“"),
    field("Your review question", questionStage),
    h("div", { class: "example-controls" }, home && indicators,
    h("div", { class: "example-toolbar" }, h("span", {}, "Need inspiration?"),
      btn([stageIcon("chevron-left"), "Previous"], () => { pause(); chooseExample(index - 1); }, "example-control"),
      home && playback,
      btn(["Next example", stageIcon("chevron")], () => { pause(); chooseExample(index + 1); }, "example-control"))));
  if (home) {
    exampleLabel.textContent = first.name;
    root.append(h("header", { class: "question-hero" },
      h("div", { class: "question-hero-copy" }, h("div", { class: "eyebrow" }, h("span", { class: "hero-live-dot", "aria-hidden": "true" }), "Question first. Evidence next."),
        h("h1", {}, "What do you want", h("br"), "to know, ", h("span", {}, "and why?")),
        h("p", { class: "lead" }, "Start with your question. Choose its purpose. Build a review you can stand behind."),
        h("div", { class: "question-hero-links" }, resumeHref && h("a", { class: "btn", href: resumeHref }, stageIcon("folder"), "Continue your review"),
          h("a", { href: "#/guide/protocol" }, "Explore the eight steps →")),
        h("p", { class: "small muted" }, "No account or API key needed · AI is optional"), walkthrough), questionCard));
  } else {
    exampleLabel.textContent = "Your question · a draft is enough";
    root.append(h("div", { class: "section-heading" }, h("div", {}, h("div", { class: "eyebrow" }, "Start here"), h("h2", {}, "What do you want to know, and why?"))), questionCard);
  }

  function drawPurpose() {
    purposeHost.replaceChildren(...PURPOSES.map(p => h("button", { type: "button", title: p.hint, "data-purpose": p.id, class: `purpose-choice${draft.purpose === p.id ? " selected" : ""}`, "aria-pressed": String(draft.purpose === p.id), onclick: () => {
      pause(); draft.purpose = p.id; draft.type = p.suggested; draft.framework = REVIEW_TYPES[p.suggested].framework;
      drawPurpose(); drawPlan(); purposeHost.querySelector(`[data-purpose="${p.id}"]`).focus(); onChange({ ...draft }, "purpose");
    } }, stageIcon(p.icon), h("strong", {}, home ? ({ answer: "Answer a question", map: "Map a field", background: "Background", decision: "Inform a decision", update: "Update evidence" }[p.id]) : p.label),
      h("small", {}, p.hint))));
  }

  function drawPlan() {
    planHost.replaceChildren();
    if (!draft.purpose) {
      planHost.append(h("p", { class: "help" }, "Choose a purpose above to see a suggested review type. You can change the suggestion."));
      return;
    }
    const type = REVIEW_TYPES[draft.type] || REVIEW_TYPES.systematic;
    const recommendation = suggestedType(draft.purpose);
    const picker = h("div", { class: "review-type-picker", "aria-label": "Review type" }, Object.entries(REVIEW_TYPES).map(([key, t]) =>
      h("button", { type: "button", "data-review-type": key, class: draft.type === key ? "selected" : "", "aria-pressed": String(draft.type === key), onclick: () => {
        pause(); draft.type = key; draft.framework = t.framework; compareOpen = true; drawPlan(); planHost.querySelector(`[data-review-type="${key}"]`).focus(); onChange({ ...draft }, "type");
      } }, h("span", {}, t.label), h("small", {}, t.short), key === recommendation && h("span", { class: "suggested-label" }, "Starting suggestion"))));
    const details = h("div", { class: "review-type-detail" }, h("div", { class: "eyebrow" }, "Your review, your choice"),
      h("h3", {}, type.label), h("p", {}, type.why),
      h("dl", { class: "review-type-facts" }, h("dt", {}, stageIcon("protocol"), "Shape the question"), h("dd", {}, type.question),
        h("dt", {}, stageIcon("report"), "Reporting"), h("dd", {}, type.reporting,
          type.checklist && h("a", { class: "checklist-link", href: type.checklist, target: "_blank", rel: "noopener" }, "Open checklist ↗"))),
      disclosure("verify", "What this choice means for the work", "Search, appraisal and synthesis", h("p", {}, type.work), h("h4", {}, "Appraisal: checking trustworthiness"), h("p", {}, type.appraisal)));
    if (draft.purpose === "decision") details.append(h("p", { class: "review-choice-note" }, "A deadline may point to a rapid review; several existing reviews may point to an umbrella review. Choose according to the question and available evidence."));
    if (draft.purpose === "update") details.append(
      field("How will you keep it current?", select(draft.maintenance, [["update", "A one-time update"], ["living", "A living review with planned ongoing updates"]], value => {
        pause(); draft.maintenance = value; onChange({ ...draft }, "maintenance");
      })), h("p", { class: "review-choice-note" }, "Keep the underlying review type of the original review unless you deliberately change the method. “Living” describes ongoing updates. Sieve does not monitor new publications automatically."));
    const fullPlan = h("div", { class: "review-plan" }, picker, details);
    if (!home) planHost.append(fullPlan);
    else planHost.append(h("div", { class: "home-review-suggestion" },
      h("strong", {}, stageIcon("verify"), type.label), h("p", {}, type.short)));
    if (home) planHost.append(h("div", { class: "review-start-actions" },
      btn(["Start my review", stageIcon("arrow")], async e => {
        pause();
        if (!question.value.trim()) { question.focus(); question.reportValidity(); return; }
        const button = e.currentTarget; button.disabled = true;
        try { await onStart?.({ ...draft, question: question.value.trim() }); }
        catch (err) { toast(err.message, "err"); button.disabled = false; }
      }, "primary"), h("span", { class: "small muted" }, "Refine your choices in step 1.")));
    if (home) {
      const comparison = h("details", { class: "home-type-comparison", open: compareOpen },
        h("summary", {}, "Compare review types & methods", stageIcon("chevron")), fullPlan, methodGuidance);
      comparison.addEventListener("toggle", () => { if (comparison.isConnected) compareOpen = comparison.open; });
      planHost.append(comparison);
    }
  }

  const purposeSection = h("div", { class: "purpose-section" }, h("div", { class: "section-heading" }, h("div", {},
    h("h2", {}, home ? "I want to…" : "What will you use the answer for?"), !home && h("p", { class: "muted" }, "Your purpose helps you choose a review type. Select one to see the differences."))), purposeHost);
  const methodGuidance = disclosure("info", "How do I choose confidently?", "Question, purpose and methods belong together",
      h("p", {}, "These are suggestions to discuss with your team or librarian. A research gap is often a finding of the review, not its only purpose. The same topic can support different review types."),
      h("p", {}, "Sieve helps organise the work. Your chosen type still needs appropriate appraisal, synthesis and reporting; selecting a type does not complete those methods."),
      h("p", { class: "small" }, "Sources: ", h("a", { href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6245623/", target: "_blank", rel: "noopener" }, "Munn et al. (2018)"), " · ",
        h("a", { href: "https://doi.org/10.1111/j.1471-1842.2009.00848.x", target: "_blank", rel: "noopener" }, "Grant & Booth (2009)"), " · ",
        h("a", { href: "https://methods.cochrane.org/rapidreviews/cochrane-rr-methods", target: "_blank", rel: "noopener" }, "Cochrane rapid review guidance"), " · ",
        h("a", { href: "https://jbi-global-wiki.refined.site/space/MANUAL/355862791/jbi-global-wiki.refined.site", target: "_blank", rel: "noopener" }, "JBI: scoping review appraisal")));
  if (home) questionCard.append(purposeSection, planHost);
  else root.append(purposeSection, planHost, methodGuidance);
  drawPurpose(); drawPlan(); updatePlayback(); updateIndicators();
  if (home) { document.addEventListener("visibilitychange", visibilityChanged); schedule(); }
  return { el: root, destroy };
}

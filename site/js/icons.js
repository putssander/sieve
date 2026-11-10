// Small, local SVGs share one stroke style and inherit the surrounding theme.
// Labels beside the icons carry their accessible names.
const paths = {
  info: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z", "M12 11v6M12 7v.1"],
  general: ["M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"],
  chat: ["M4 4h16v12H9l-5 4Z", "M8 8h8M8 12h5"],
  connect: ["M8 3v5M16 3v5M5 8h14v3a7 7 0 0 1-14 0ZM12 18v4"],
  computer: ["M3 4h18v13H3zM8 21h8M12 17v4"],
  clock: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z", "M12 7v5l3 2"],
  folder: ["M3 6h7l2 3h9v11H3ZM3 6V4h7l2 2h7v3"],
  arrow: ["M4 12h16m-6-6 6 6-6 6"],
  chevron: ["m8 5 7 7-7 7"],
  costs: ["M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z", "M15 8h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9M12 6v12"],
  protocol: ["M9 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3", "M9 3h6v4H9z", "M8 12h8M8 16h6"],
  search: ["M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z", "m15 15 6 6"],
  records: ["M8 3h12v14H8z", "M4 7v14h12", "M11 7h6M11 11h6"],
  verify: ["M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z", "m8 12 3 3 5-6"],
  fulltext: ["M12 5C9 3 6 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z", "M12 5v15M6 8h3M6 12h3M15 8h3M15 12h3"],
  screening: ["M3 4h18l-7 8v7l-4 2v-9Z"],
  extraction: ["M3 4h11v16H3zM3 9h11M3 14h11M8 4v16", "M17 12h5m-3-3 3 3-3 3"],
  report: ["M14 3H5v18h14V8Z", "M14 3v5h5M8 17v-3M12 17v-6M16 17v-4"],
};

export function stageIcon(id) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [key, value] of Object.entries({ class: "stage-icon", viewBox: "0 0 24 24", width: "24", height: "24", fill: "none", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) svg.setAttribute(key, value);
  for (const d of paths[id] || []) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

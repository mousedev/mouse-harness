// Pass rate against cost per pass: Mouse plotted with the published FrontierHarness
// baselines. FH's generate-chart.mjs drops a candidate marked comparable:false from
// the plot; this one plots it and includes it in the frontier.
//   node evals/frontierharness/chart.mjs evals/runs/<run-id>
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const runDir = process.argv[2] ?? die("usage: chart.mjs evals/runs/<run-id>");
const candidate = JSON.parse(await readFile(join(runDir, "candidate.json"), "utf8"));

// frontierharness.org eval-data.json (generated 2026-08-22): pass_rate, effective_cost_per_pass.
const BASELINE_DATE = "2026-08-22";
const baselines = [
  ["codex", "Codex", 20 / 30, 3.468296325, "#9385ff", "circle"],
  ["dsh-creator", "DSH Creator", 19 / 30, 3.2849, "#70b6ee", "triangle"],
  ["claude-code", "Claude Code", 19 / 30, 18.3368, "#f0a57f", "diamond"],
  ["pi-responses", "Pi", 18 / 30, 2.433, "#f0f0f0", "square"],
  ["dsh-ptc", "DSH PTC", 18 / 30, 4.5774, "#75b8ed", "diamond"],
  ["dsh-standard", "DSH Standard", 18 / 30, 3.4589, "#75b8ed", "square"],
  ["oh-my-pi", "Oh My Pi", 17 / 30, 4.7455, "#f2a777", "diamond"],
  ["kimi-code", "Kimi Code", 17 / 30, 3.6471, "#83d7c5", "circle"],
  ["dsh-minimal", "DSH Minimal", 17 / 30, 4.718, "#75b8ed", "circle"],
  ["exo", "Exo Harness", 16 / 30, 1.0452, "#d3d3d3", "hexagon"],
  ["opencode", "OpenCode", 15 / 30, 3.2443, "#a978e7", "square"],
  ["hermes", "Hermes", 15 / 30, 2.9043, "#a3a3a3", "triangle"],
].map(([name, label, passRate, cost, color, shape]) => ({ name, label, passRate, cost, color, shape }));

const accent = "#ff7a12";
const mouse = {
  name: "mouse", label: candidate.label, passRate: candidate.pass_rate,
  cost: candidate.effective_cost_per_pass, color: accent, shape: "star", isCandidate: true,
};
const points = [...baselines, mouse];

const width = 1344, height = 770;
const plot = { x: 102, y: 96, width: 1200, height: 560 };
const xDomain = { min: 0.83, max: 23 };
const yDomain = { min: 0.46, max: 0.87 };
const px = cost => plot.x + Math.log(cost / xDomain.min) / Math.log(xDomain.max / xDomain.min) * plot.width;
const py = rate => plot.y + (yDomain.max - rate) / (yDomain.max - yDomain.min) * plot.height;
const esc = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const money = value => `$${value.toFixed(2)}`;
const percent = value => `${(value * 100).toFixed(1)}%`;
const metric = point => `${percent(point.passRate)} · ${money(point.cost)}`;

// Pareto frontier: no other point is at least as cheap and at least as good.
const frontier = points
  .filter(p => !points.some(o => o.cost <= p.cost && o.passRate >= p.passRate && (o.cost < p.cost || o.passRate > p.passRate)))
  .sort((a, b) => a.cost - b.cost);

function marker(shape, x, y, color, size = 6.5) {
  const common = `fill="${color}" stroke="#c4c4c4" stroke-width="1.1"`;
  if (shape === "star") {
    const vertices = Array.from({ length: 10 }, (_, i) => {
      const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? size * 0.45 : size;
      return `${(x + Math.cos(a) * r).toFixed(2)},${(y + Math.sin(a) * r).toFixed(2)}`;
    }).join(" ");
    return `<polygon points="${vertices}" ${common}/>`;
  }
  if (shape === "circle") return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${size}" ${common}/>`;
  if (shape === "square") return `<rect x="${(x - size).toFixed(2)}" y="${(y - size).toFixed(2)}" width="${size * 2}" height="${size * 2}" ${common}/>`;
  const unit = shape === "diamond" ? [[0, -1], [1, 0], [0, 1], [-1, 0]]
    : shape === "triangle" ? [[0, -1], [1, 1], [-1, 1]]
    : [[-1, 0], [-0.5, -1], [0.5, -1], [1, 0], [0.5, 1], [-0.5, 1]];
  return `<polygon points="${unit.map(([dx, dy]) => `${(x + dx * size).toFixed(2)},${(y + dy * size).toFixed(2)}`).join(" ")}" ${common}/>`;
}

// Label placement: try offsets above/below and either side until nothing overlaps.
const overlaps = (a, b, p = 4) => a.left < b.right + p && a.right > b.left - p && a.top < b.bottom + p && a.bottom > b.top - p;
const obstacles = points.map(p => ({ left: px(p.cost) - 10, right: px(p.cost) + 10, top: py(p.passRate) - 10, bottom: py(p.passRate) + 10 }));
const placed = [];
const annotations = [...points].sort((a, b) => Number(!!b.isCandidate) - Number(!!a.isCandidate)).map(point => {
  const x = px(point.cost), y = py(point.passRate);
  const big = point.isCandidate;
  const w = Math.max(point.label.length * (big ? 9.5 : 7.5), metric(point).length * (big ? 8.4 : 7.2));
  const sides = point.name === "kimi-code" || point.name === "hermes" ? [-1, 1] : [1, -1];
  const gap = big ? 22 : 13;
  let selected;
  for (const dy of [-3, -34, 27, 55, -62, 83, -90, 111, -118, 139, -146]) {
    for (const side of sides) {
      const lx = x + side * gap;
      const rect = { left: side === 1 ? lx : lx - w, right: side === 1 ? lx + w : lx, top: y + dy - 12, bottom: y + dy + 20 };
      if (rect.left < plot.x + 2 || rect.right > plot.x + plot.width - 2 || rect.top < plot.y || rect.bottom > plot.y + plot.height) continue;
      if (placed.some(o => overlaps(rect, o)) || obstacles.some(o => overlaps(rect, o, 2))) continue;
      selected = { lx, ly: y + dy, dy, anchor: side === 1 ? "start" : "end", rect };
      break;
    }
    if (selected) break;
  }
  if (!selected) die(`no collision-free label placement for ${point.label}`);
  placed.push(selected.rect);
  const { lx, ly, dy, anchor } = selected;
  // A label pushed off its marker's row gets a leader line so it can't be read as a neighbour's.
  const leader = dy === -3 ? "" : `<line x1="${x.toFixed(2)}" y1="${y.toFixed(2)}" x2="${lx.toFixed(2)}" y2="${(dy > 0 ? ly - 13 : ly + 9).toFixed(2)}" stroke="#666" stroke-width="1"/>`;
  const cls = big ? ' style="font-size:17px;font-weight:700"' : "";
  const valueCls = big ? ' style="font-size:14px;fill:#e6e6e6"' : "";
  return `${leader}<text class="point-name" x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" fill="${point.color}" text-anchor="${anchor}"${cls}><tspan x="${lx.toFixed(2)}">${esc(point.label)}</tspan><tspan class="point-value" x="${lx.toFixed(2)}" dy="18"${valueCls}>${metric(point)}</tspan></text>`;
}).join("\n");

const dots = [...points].sort((a, b) => Number(!!a.isCandidate) - Number(!!b.isCandidate)).map(point => {
  const x = px(point.cost), y = py(point.passRate);
  const halo = point.isCandidate ? `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="18" fill="none" stroke="${accent}" stroke-opacity=".45"/>` : "";
  return halo + marker(point.shape, x, y, point.color, point.isCandidate ? 12 : 6.5);
}).join("\n");

let legendX = 48, legendY = 29;
const legend = points.map(point => {
  const itemWidth = point.label.length * 7.4 + 30;
  if (legendX + itemWidth > width - 35) { legendX = 48; legendY += 25; }
  const item = marker(point.shape, legendX, legendY - 4, point.color, point.isCandidate ? 7 : 4.7)
    + `<text class="legend" x="${legendX + 11}" y="${legendY}">${esc(point.label)}</text>`;
  legendX += itemWidth;
  return item;
}).join("");

const gridX = [1, 2, 5, 10, 20].map(v => `<line x1="${px(v).toFixed(2)}" y1="${plot.y}" x2="${px(v).toFixed(2)}" y2="${plot.y + plot.height}"/><text x="${px(v).toFixed(2)}" y="${plot.y + plot.height + 27}" text-anchor="middle">$${v}</text>`).join("");
const gridY = [0.5, 0.6, 0.7, 0.8].map(v => `<line x1="${plot.x}" y1="${py(v).toFixed(2)}" x2="${plot.x + plot.width}" y2="${py(v).toFixed(2)}"/><text x="${plot.x - 13}" y="${(py(v) + 5).toFixed(2)}" text-anchor="end">${Math.round(v * 100)}%</text>`).join("");

const notes = [
  `Cost per pass = total task cost ÷ tasks passed (frontierharness.org labels this column "median cost per task"). Baselines: FrontierHarness published data, ${BASELINE_DATE}.`,
  `${candidate.label}: run ${candidate.run_id}, ${candidate.successful}/${candidate.expected} passed, Kimi K3 via Fireworks. Submitted to FrontierHarness for reproduction; not yet on their leaderboard.`,
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(candidate.label)} and the FrontierHarness baselines: pass rate against cost per pass">
<rect width="${width}" height="${height}" fill="#000"/>
<style>
text{font-family:Arial,Helvetica,sans-serif}.legend,.axis,.point-value,.grid text,.note{font-family:Menlo,Consolas,monospace}
.legend{font-size:11px;fill:#b5b5b5}.grid line{stroke:#333;stroke-dasharray:4 2;stroke-width:1}.grid text{fill:#ccc;font-size:15px}
.point-name{font-size:14px}.point-value{fill:#bcbcbc;font-size:12px}.axis{fill:#ccc;font-size:15px}.note{fill:#aaa;font-size:11px}
</style>
${legend}
<g class="grid">${gridX}${gridY}</g>
<path d="M ${plot.x} ${plot.y} V ${plot.y + plot.height} H ${plot.x + plot.width}" fill="none" stroke="#ccc" stroke-width="1.2"/>
<polyline points="${frontier.map(p => `${px(p.cost).toFixed(2)},${py(p.passRate).toFixed(2)}`).join(" ")}" fill="none" stroke="${accent}" stroke-width="2.2" stroke-opacity=".8"/>
${annotations}
${dots}
<text class="axis" x="${plot.x + plot.width / 2}" y="${plot.y + plot.height + 57}" text-anchor="middle">Cost per pass (log scale)</text>
<text class="axis" transform="translate(49 ${plot.y + plot.height / 2}) rotate(-90)" text-anchor="middle">Pass rate</text>
${notes.map((line, i) => `<text class="note" x="48" y="${height - 30 + i * 15}">${esc(line)}</text>`).join("\n")}
</svg>
`;

await writeFile(join(runDir, "report", "chart.svg"), svg);
console.log(`wrote ${join(runDir, "report", "chart.svg")}; frontier: ${frontier.map(p => p.label).join(" → ")}`);

function die(message) {
  console.error(message);
  process.exit(2);
}

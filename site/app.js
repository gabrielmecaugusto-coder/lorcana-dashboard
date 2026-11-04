/* Lorcana Price Dashboard — static client. Data comes from ./data (built daily by GitHub Actions). */
"use strict";

const INKS = [
  ["Amber", "#f2b51c"], ["Amethyst", "#8a4fb5"], ["Emerald", "#2e9e53"],
  ["Ruby", "#d23a3a"], ["Sapphire", "#2f7fd1"], ["Steel", "#8f979e"],
];
const RARITY_ORDER = ["Common", "Uncommon", "Rare", "Super Rare", "Legendary", "Epic", "Enchanted", "Iconic", "Promo"];
const WINDOW_LABEL = { d1: "1 dia", d7: "7 dias", d30: "30 dias", d90: "90 dias", d365: "1 ano", all: "desde o início" };
const MOVERS_MIN_PRICE = 1; // ignore penny cards in the movers lists (noise)
const PAGE = 50;

const S = {
  cards: [], sets: [], setsById: new Map(), setHist: null, latest: null, first: null,
  histories: new Map(), // groupId -> {dates, s}
  filter: { window: "d30", from: "", to: "", set: "", inks: new Set(), rarity: "", printing: "", min: 0, q: "" },
  sort: { key: "price", dir: -1 }, page: 0, tab: "overview", charts: {}, detail: null, gran: "monthly",
};

const $ = (id) => document.getElementById(id);
const usd = (v, d = 2) => v == null ? "–" : "US$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const usd0 = (v) => usd(v, v >= 1000 ? 0 : 2);
const pctTxt = (v) => v == null ? "–" : (v > 0 ? "▲ +" : v < 0 ? "▼ " : "") + v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
const fmtDate = (iso) => iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("pt-BR") : "–";
const css = (name) => getComputedStyle(document.querySelector(".viz-root")).getPropertyValue(name).trim();

async function getJSON(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}

async function init() {
  const [cards, sets, setHist] = await Promise.all([
    getJSON("data/cards.json"), getJSON("data/sets.json"), getJSON("data/set_history.json"),
  ]);
  S.cards = cards.cards;
  S.latest = cards.latest; S.first = cards.firstSnapshot;
  S.sets = sets.filter((s) => s.cards > 0);
  S.sets.forEach((s) => S.setsById.set(s.groupId, s));
  S.setHist = setHist;
  $("updated").textContent = `Preços de ${fmtDate(S.latest)} · ${S.cards.length.toLocaleString("pt-BR")} cartas/impressões · histórico desde ${fmtDate(S.first)}`;
  buildFilters();
  readHash();
  render();
}

/* ---------- filters ---------- */
function buildFilters() {
  const setSel = $("f-set");
  [...S.sets].reverse().forEach((s) => setSel.add(new Option(`${s.name} (${s.abbreviation})`, s.groupId)));
  const rar = new Set(S.cards.map((c) => c.rarity).filter(Boolean));
  const rarSorted = [...rar].sort((a, b) => rank(a) - rank(b));
  rarSorted.forEach((r) => $("f-rarity").add(new Option(r, r)));
  const wrap = $("f-inks");
  INKS.forEach(([name, color]) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "ink"; b.setAttribute("aria-pressed", "false"); b.dataset.ink = name;
    const dot = document.createElement("i"); dot.style.background = color;
    b.append(dot, document.createTextNode(name));
    b.onclick = () => { const on = S.filter.inks.has(name); on ? S.filter.inks.delete(name) : S.filter.inks.add(name); changed(); };
    wrap.append(b);
  });
  $("f-from").min = $("f-to").min = S.first; $("f-from").max = $("f-to").max = S.latest;
  const bind = (id, key, ev = "change", map = (v) => v) => $(id).addEventListener(ev, (e) => { S.filter[key] = map(e.target.value); changed(); });
  bind("f-window", "window"); bind("f-from", "from"); bind("f-to", "to"); bind("f-set", "set");
  bind("f-rarity", "rarity"); bind("f-printing", "printing"); bind("f-min", "min", "input", (v) => +v || 0);
  bind("f-q", "q", "input", (v) => v.trim().toLowerCase());
  $("f-reset").onclick = () => { S.filter = { ...S.filter, set: "", inks: new Set(), rarity: "", printing: "", min: 0, q: "" }; syncControls(); changed(); };
  document.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => { S.tab = b.dataset.tab; changed(); });
  $("pg-prev").onclick = () => { S.page = Math.max(0, S.page - 1); renderCards(); };
  $("pg-next").onclick = () => { S.page++; renderCards(); };
  document.querySelectorAll(".seg button").forEach((b) => b.onclick = () => { S.gran = b.dataset.gran; renderDetailChart(); });
}
const rank = (r) => { const i = RARITY_ORDER.indexOf(r); return i < 0 ? 99 : i; };

function syncControls() {
  const f = S.filter;
  $("f-window").value = f.window; $("f-from").value = f.from; $("f-to").value = f.to; $("f-set").value = f.set;
  $("f-rarity").value = f.rarity; $("f-printing").value = f.printing; $("f-min").value = f.min; $("f-q").value = f.q;
  document.querySelectorAll(".ink").forEach((b) => b.setAttribute("aria-pressed", f.inks.has(b.dataset.ink)));
  document.querySelector(".custom-range").hidden = f.window !== "custom";
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === S.tab));
  document.querySelectorAll(".tab").forEach((t) => t.hidden = t.id !== "tab-" + S.tab);
}

function writeHash() {
  const f = S.filter, p = new URLSearchParams();
  if (S.tab !== "overview") p.set("tab", S.tab);
  if (f.window !== "d30") p.set("w", f.window);
  if (f.window === "custom") { p.set("from", f.from); p.set("to", f.to); }
  if (f.set) p.set("set", f.set);
  if (f.inks.size) p.set("ink", [...f.inks].join(","));
  if (f.rarity) p.set("rar", f.rarity);
  if (f.printing) p.set("pr", f.printing);
  if (f.min) p.set("min", f.min);
  if (f.q) p.set("q", f.q);
  history.replaceState(null, "", p.toString() ? "#" + p : location.pathname);
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1)), f = S.filter;
  S.tab = p.get("tab") || "overview";
  f.window = p.get("w") || "d30"; f.from = p.get("from") || ""; f.to = p.get("to") || "";
  f.set = p.get("set") || ""; f.inks = new Set((p.get("ink") || "").split(",").filter(Boolean));
  f.rarity = p.get("rar") || ""; f.printing = p.get("pr") || ""; f.min = +(p.get("min") || 0); f.q = p.get("q") || "";
  if (f.window === "custom" && !f.from) { f.from = S.first; f.to = S.latest; }
  syncControls();
}

let pending = 0;
async function changed() {
  const f = S.filter;
  if (f.window === "custom" && (!f.from || !f.to)) { f.from = f.from || addDays(S.latest, -30); f.to = f.to || S.latest; }
  S.page = 0; syncControls(); writeHash();
  const my = ++pending;
  document.querySelector("main").style.opacity = 0.6;
  if (f.window === "custom") await loadHistories(filteredSets());
  if (my !== pending) return;
  document.querySelector("main").style.opacity = 1;
  render();
}
function addDays(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function filteredSets() { return S.filter.set ? [+S.filter.set] : S.sets.map((s) => s.groupId); }

function passes(c) {
  const f = S.filter;
  if (f.set && c.set !== +f.set) return false;
  if (f.inks.size && !(c.ink && c.ink.split(/[;\/,]\s*/).some((i) => f.inks.has(i)))) return false;
  if (f.rarity && c.rarity !== f.rarity) return false;
  if (f.printing && c.printing !== f.printing) return false;
  if (f.min && !(c.price >= f.min)) return false;
  if (f.q && !c.name.toLowerCase().includes(f.q)) return false;
  return true;
}

/* ---------- history ---------- */
async function loadHistory(gid) {
  if (!S.histories.has(gid)) S.histories.set(gid, getJSON(`data/history/${gid}.json`));
  return S.histories.get(gid);
}
async function loadHistories(gids) { await Promise.all(gids.map(loadHistory)); for (const g of gids) S.histories.set(g, await S.histories.get(g)); }

function priceAt(h, key, iso) {
  const arr = h.s[key]; if (!arr) return null;
  let i = h.dates.length - 1;
  while (i >= 0 && h.dates[i] > iso) i--;
  for (let k = i; k >= 0 && k > i - 8; k--) if (arr[k]) return arr[k];
  return null;
}

/** Window change for a card: {then, now, pct} */
function change(c) {
  const f = S.filter;
  if (f.window !== "custom") {
    const p = c.ch[f.window];
    return { now: c.price, pct: p, then: p == null || !c.price ? null : c.price / (1 + p / 100) };
  }
  const h = S.histories.get(c.set);
  if (!h || h instanceof Promise) return { now: null, then: null, pct: null };
  const then = priceAt(h, c.id, f.from), now = priceAt(h, c.id, f.to);
  return { then, now, pct: then && now ? Math.round((now / then - 1) * 1000) / 10 : null };
}
function windowText() {
  const f = S.filter;
  return f.window === "custom" ? `${fmtDate(f.from)} → ${fmtDate(f.to)}` : WINDOW_LABEL[f.window];
}

/* ---------- render ---------- */
function render() {
  const rows = S.cards.filter(passes);
  S.rows = rows;
  if (S.tab === "overview") renderOverview(rows);
  if (S.tab === "movers") renderMovers(rows);
  if (S.tab === "cards") renderCards();
}

function renderOverview(rows) {
  const priced = rows.filter((c) => c.price);
  const total = priced.reduce((a, c) => a + c.price, 0);
  $("k-count").textContent = rows.length.toLocaleString("pt-BR");
  $("k-total").textContent = usd0(total);
  $("k-avg").textContent = usd(priced.length ? total / priced.length : null);
  let now = 0, then = 0;
  rows.forEach((c) => { const x = change(c); if (x.now && x.then) { now += x.now; then += x.then; } });
  const p = then ? (now / then - 1) * 100 : null;
  const kc = $("k-change"); kc.textContent = pctTxt(p == null ? null : Math.round(p * 10) / 10);
  kc.className = "kpi-value " + (p > 0 ? "up" : p < 0 ? "down" : "");
  $("k-change-sub").textContent = windowText() + " · cartas com preço nas duas datas";

  // Set totals (horizontal bars, release order)
  const bySet = new Map();
  priced.forEach((c) => bySet.set(c.set, (bySet.get(c.set) || 0) + c.price));
  const setRows = S.sets.filter((s) => bySet.has(s.groupId)).reverse();
  barChart("c-sets", setRows.map((s) => s.name), setRows.map((s) => Math.round(bySet.get(s.groupId) * 100) / 100), {
    horizontal: true,
    tooltip: (i) => [`${usd0(setRows[i] && bySet.get(setRows[i].groupId))}`, `${priced.filter((c) => c.set === setRows[i].groupId).length} cartas · lançada em ${fmtDate(setRows[i].publishedOn)}`],
  });

  // Rarity averages
  const byR = new Map();
  priced.forEach((c) => { const r = c.rarity || "—"; if (!byR.has(r)) byR.set(r, []); byR.get(r).push(c.price); });
  const rk = [...byR.keys()].sort((a, b) => rank(a) - rank(b));
  const stats = rk.map((r) => { const v = byR.get(r).sort((a, b) => a - b); return { r, avg: v.reduce((a, b) => a + b, 0) / v.length, med: v[Math.floor(v.length / 2)], n: v.length }; });
  barChart("c-rarity", rk, stats.map((s) => Math.round(s.avg * 100) / 100), {
    log: stats.length > 1 && Math.max(...stats.map((s) => s.avg)) / Math.max(0.01, Math.min(...stats.map((s) => s.avg))) > 50,
    tooltip: (i) => [`Média ${usd(stats[i].avg)}`, `Mediana ${usd(stats[i].med)} · ${stats[i].n} cartas`],
  });

  // Set value history
  const h = S.setHist, gids = filteredSets().map(String);
  const vals = h.dates.map((_, i) => { let s = 0, any = false; gids.forEach((g) => { const v = h.sets[g] && h.sets[g][i]; if (v) { s += v; any = true; } }); return any ? Math.round(s) : null; });
  $("sethist-label").textContent = S.filter.set ? "· " + S.setsById.get(+S.filter.set).name : "· todas as coleções";
  lineChart("c-sethist", h.dates, vals, "Valor total");
}

function renderMovers(rows) {
  const list = rows.map((c) => ({ c, x: change(c) })).filter((o) => o.x.pct != null && o.x.now >= MOVERS_MIN_PRICE);
  const up = list.filter((o) => o.x.pct > 0).sort((a, b) => b.x.pct - a.x.pct).slice(0, 25);
  const down = list.filter((o) => o.x.pct < 0).sort((a, b) => a.x.pct - b.x.pct).slice(0, 25);
  $("movers-note").textContent = `Janela: ${windowText()}. Só cartas com preço atual a partir de ${usd(MOVERS_MIN_PRICE)}, para evitar ruído de cartas de centavos. ${list.length} cartas com preço nas duas datas.`;
  moverTable($("t-up"), up); moverTable($("t-down"), down);
}

function moverTable(tbl, items) {
  tbl.replaceChildren();
  const head = tbl.createTHead().insertRow();
  [["", ""], ["Carta", ""], ["Antes", "num"], ["Agora", "num"], ["Variação", "num"]].forEach(([t, cl]) => { const th = document.createElement("th"); th.textContent = t; th.className = cl; head.append(th); });
  const body = tbl.createTBody();
  if (!items.length) { const td = body.insertRow().insertCell(); td.colSpan = 5; td.textContent = "Nenhuma carta no filtro."; td.className = "muted"; }
  items.forEach(({ c, x }) => {
    const tr = body.insertRow(); tr.tabIndex = 0;
    tr.onclick = tr.onkeydown = (e) => { if (e.type === "click" || e.key === "Enter") openDetail(c); };
    imgCell(tr, c); nameCell(tr, c);
    numCell(tr, usd(x.then)); numCell(tr, usd(x.now));
    const td = numCell(tr, pctTxt(x.pct)); td.className += x.pct > 0 ? " up" : " down";
  });
}

function imgCell(tr, c) { const td = tr.insertCell(); if (c.img) { const im = new Image(); im.loading = "lazy"; im.src = c.img; im.alt = ""; td.append(im); } }
function nameCell(tr, c) {
  const td = tr.insertCell(); td.className = "name"; td.append(document.createTextNode(c.name));
  const sm = document.createElement("small");
  sm.textContent = [S.setsById.get(c.set)?.name, c.num, c.rarity, c.ink, c.printing !== "Normal" ? c.printing : ""].filter(Boolean).join(" · ");
  td.append(sm);
}
function numCell(tr, txt) { const td = tr.insertCell(); td.className = "num"; td.textContent = txt; return td; }

const COLS = [
  ["img", "", null], ["name", "Carta", (c) => c.name], ["rarity", "Raridade", (c) => rank(c.rarity)],
  ["price", "Preço", (c) => c.price ?? -1], ["low", "Menor anúncio", (c) => c.low ?? -1],
  ["chg", "Variação", (c) => change(c).pct ?? -1e9],
];
function renderCards() {
  const tbl = $("t-cards"), rows = [...S.rows];
  const col = COLS.find((c) => c[0] === S.sort.key);
  rows.sort((a, b) => { const x = col[2](a), y = col[2](b); return (x > y ? 1 : x < y ? -1 : 0) * S.sort.dir; });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); S.page = Math.min(S.page, pages - 1);
  $("pg-info").textContent = `${S.page + 1} / ${pages}`;
  $("cards-count").textContent = `· ${rows.length.toLocaleString("pt-BR")} · variação em ${windowText()}`;
  tbl.replaceChildren();
  const head = tbl.createTHead().insertRow();
  COLS.forEach(([k, t, f]) => {
    const th = document.createElement("th"); th.textContent = t;
    if (["price", "low", "chg"].includes(k)) th.className = "num";
    if (f) { th.tabIndex = 0; if (S.sort.key === k) th.setAttribute("aria-sort", S.sort.dir < 0 ? "descending" : "ascending");
      th.onclick = th.onkeydown = (e) => { if (e.type === "click" || e.key === "Enter") { S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : (k === "name" ? 1 : -1) }; renderCards(); } }; }
    head.append(th);
  });
  const body = tbl.createTBody();
  rows.slice(S.page * PAGE, S.page * PAGE + PAGE).forEach((c) => {
    const tr = body.insertRow(); tr.tabIndex = 0;
    tr.onclick = tr.onkeydown = (e) => { if (e.type === "click" || e.key === "Enter") openDetail(c); };
    imgCell(tr, c); nameCell(tr, c);
    tr.insertCell().textContent = c.rarity || "–";
    numCell(tr, usd(c.price)); numCell(tr, usd(c.low));
    const p = change(c).pct; const td = numCell(tr, pctTxt(p)); if (p) td.className += p > 0 ? " up" : " down";
  });
}

/* ---------- detail ---------- */
async function openDetail(c) {
  S.detail = c;
  $("d-img").src = c.img ? c.img.replace("_200w", "_400w") : ""; $("d-img").alt = c.name;
  $("d-name").textContent = c.name;
  $("d-meta").textContent = [S.setsById.get(c.set)?.name, c.num, c.rarity, c.ink, c.type, c.cost ? `custo ${c.cost}` : "", c.printing].filter(Boolean).join(" · ");
  $("d-link").href = c.url || "#";
  const k = $("d-kpis"); k.replaceChildren();
  const add = (label, val, cls = "") => { const d = document.createElement("div"); d.className = "kpi";
    const l = document.createElement("span"); l.className = "kpi-label"; l.textContent = label;
    const v = document.createElement("span"); v.className = "kpi-value " + cls; v.textContent = val; d.append(l, v); k.append(d); };
  add("Market price", usd(c.price)); add("Menor anúncio", usd(c.low));
  [["d7", "7 dias"], ["d30", "30 dias"], ["d365", "1 ano"], ["all", "Desde " + (c.first ? fmtDate(c.first[0]) : "–")]].forEach(([w, l]) => {
    const v = c.ch[w]; add(l, pctTxt(v), v > 0 ? "up" : v < 0 ? "down" : ""); });
  $("detail").showModal();
  await loadHistories([c.set]);
  renderDetailChart();
}
function renderDetailChart() {
  document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.gran === S.gran));
  const c = S.detail; if (!c) return;
  const h = S.histories.get(c.set); if (!h || h instanceof Promise) return;
  let dates = h.dates, vals = h.s[c.id] || [];
  if (S.gran === "monthly") {
    const m = new Map();
    dates.forEach((d, i) => { if (vals[i]) m.set(d.slice(0, 7), vals[i]); });
    dates = [...m.keys()]; vals = [...m.values()];
  }
  lineChart("c-detail", dates, vals, "Preço", true);
}

/* ---------- charts (Chart.js) ---------- */
function baseOpts() {
  const grid = css("--grid"), text = css("--text-secondary");
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = text;
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false },
      tooltip: { backgroundColor: css("--surface-1"), titleColor: css("--text-secondary"), bodyColor: css("--text-primary"),
        borderColor: css("--border"), borderWidth: 1, padding: 10, displayColors: false, bodyFont: { weight: "600" } } },
    scales: { x: { grid: { color: grid, drawTicks: false }, border: { display: false } }, y: { grid: { color: grid, drawTicks: false }, border: { display: false } } },
  };
}
function barChart(id, labels, data, { horizontal = false, log = false, tooltip }) {
  const o = baseOpts(), vAxis = horizontal ? "x" : "y", cAxis = horizontal ? "y" : "x";
  o.indexAxis = horizontal ? "y" : "x";
  o.scales[cAxis].grid.display = false;
  o.scales[vAxis].type = log ? "logarithmic" : "linear";
  o.scales[vAxis].ticks = { callback: (v) => (log && ![1, 10, 100, 1000, 10000, 100000].includes(v)) ? "" : "$" + Number(v).toLocaleString("pt-BR") };
  if (log) o.scales[vAxis].title = { display: true, text: "escala logarítmica" };
  o.plugins.tooltip.callbacks = { label: (ctx) => tooltip(ctx.dataIndex) };
  const ds = { data, backgroundColor: css("--series-1"), hoverBackgroundColor: css("--series-1-hover"), borderRadius: 4, borderSkipped: "start", maxBarThickness: 28, categoryPercentage: 0.85 };
  upsert(id, { type: "bar", data: { labels, datasets: [ds] }, options: o });
}
function lineChart(id, labels, values, name, monthly = false) {
  const o = baseOpts();
  // Time-proportional x axis (weekly history + daily recent data must not be spaced equally).
  const ts = (d) => Date.parse((d.length === 7 ? d + "-15" : d) + "T12:00:00Z");
  const data = labels.map((d, i) => ({ x: ts(d), y: values[i] ?? null, d }));
  const mo = (t) => { const d = new Date(t); return String(d.getUTCMonth() + 1).padStart(2, "0") + "/" + String(d.getUTCFullYear()).slice(2); };
  o.interaction = { mode: "nearest", axis: "x", intersect: false };
  o.scales.x = { type: "linear", grid: { display: false }, border: { display: false },
    min: data.length ? data[0].x : undefined, max: data.length ? data[data.length - 1].x : undefined,
    ticks: { maxTicksLimit: 8, maxRotation: 0, callback: (v) => mo(v) } };
  o.scales.y.ticks = { callback: (v) => "$" + Number(v).toLocaleString("pt-BR") };
  o.plugins.tooltip.callbacks = { title: (it) => { const d = it[0].raw.d; return d.length === 7 ? d.slice(5) + "/" + d.slice(0, 4) : fmtDate(d); }, label: (ctx) => `${usd(ctx.parsed.y)}` };
  const ds = { label: name, data, parsing: false, borderColor: css("--series-1"), borderWidth: 2, pointRadius: data.length < 40 ? 3 : 0, pointHoverRadius: 5,
    pointBackgroundColor: css("--series-1"), pointBorderColor: css("--surface-1"), pointBorderWidth: 2, spanGaps: true, tension: 0 };
  upsert(id, { type: "line", data: { labels, datasets: [ds] }, options: o, plugins: [crosshair] });
}
const crosshair = { id: "crosshair", afterDatasetsDraw(chart) {
  const a = chart.tooltip && chart.tooltip.getActiveElements(); if (!a || !a.length) return;
  const x = a[0].element.x, { top, bottom } = chart.chartArea, ctx = chart.ctx;
  ctx.save(); ctx.strokeStyle = css("--text-muted"); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.restore();
} };
function upsert(id, cfg) {
  if (S.charts[id]) S.charts[id].destroy();
  S.charts[id] = new Chart($(id), cfg);
}

window.addEventListener("DOMContentLoaded", () => init().catch((e) => { $("updated").textContent = "Erro ao carregar os dados: " + e.message; console.error(e); }));
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { render(); if (S.detail && $("detail").open) renderDetailChart(); });

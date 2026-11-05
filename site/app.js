/* Lorcana Price Dashboard — static client. Data comes from ./data (built daily by GitHub Actions). */
"use strict";

const INKS = [
  ["Amber", "#e0a400"], ["Amethyst", "#8a4fb5"], ["Emerald", "#2e9e53"],
  ["Ruby", "#d23a3a"], ["Sapphire", "#2f7fd1"], ["Steel", "#8a929a"],
];
const DUAL = ["Duas tintas", "#4f4e49"];
const INK_COLOR = Object.fromEntries([...INKS, DUAL]);
const RARITY_ORDER = ["Common", "Uncommon", "Rare", "Super Rare", "Legendary", "Epic", "Enchanted", "Iconic", "Promo", "Quest"];
const WINDOW_LABEL = { d1: "1 dia", d7: "7 dias", d30: "30 dias", d90: "90 dias", d365: "1 ano", all: "desde o lançamento (+1 semana)" };
const MOVERS_MIN_PRICE = 1; // ignore penny cards in the movers lists (noise)
const CARRY_DAYS = 7;       // a missing price is carried forward at most this long in time series
const PAGE = 50;

const S = {
  cards: [], sets: [], setsById: new Map(), events: { releases: [], rotations: [] }, latest: null, first: null,
  histories: new Map(),
  filter: { window: "d30", from: "", to: "", format: "", sets: new Set(), inks: new Set(), rarities: new Set(), mechs: new Set(), decks: new Set(), printing: "", min: 0, q: "" },
  duels: null, duelsByPid: new Map(), duelsById: new Map(), metaSort: { key: "dUse", dir: -1 }, metaPage: 0,
  deckSort: { key: "wr", dir: -1 }, muSort: { key: "games", dir: -1 }, selDeck: null, /* deck key */ deckMin: 2000,
  view: { evoMetric: "total", group: "set", distMetric: "total", chgGroup: "ink", deckView: "deck", deckEra: "", gran: "monthly", ev: { rel: true, rot: true } },
  sort: { key: "price", dir: -1 }, page: 0, tab: "overview", charts: {}, detail: null, ms: {},
};

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const usd = (v, d = 2) => v == null ? "–" : "US$ " + v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const usd0 = (v) => usd(v, v >= 1000 ? 0 : 2);
const pctTxt = (v) => v == null ? "–" : (v > 0 ? "▲ +" : v < 0 ? "▼ " : "") + v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
const fmtDate = (iso) => iso ? new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("pt-BR") : "–";
const css = (name) => getComputedStyle(document.querySelector(".viz-root")).getPropertyValue(name).trim();
const inkList = (c) => (c.ink ? c.ink.split(/[;\/,]\s*/) : []);
const inkGroup = (c) => { const l = inkList(c); return l.length === 1 ? l[0] : l.length > 1 ? DUAL[0] : null; };
const rank = (r) => { const i = RARITY_ORDER.indexOf(r); return i < 0 ? 99 : i; };
const day = (iso) => Math.round(Date.parse(iso.slice(0, 10) + "T12:00:00Z") / 864e5);

async function getJSON(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}

async function init() {
  const [cards, sets, events] = await Promise.all([getJSON("data/cards.json"), getJSON("data/sets.json"), getJSON("data/events.json")]);
  S.cards = cards.cards; S.latest = cards.latest; S.first = cards.firstSnapshot; S.events = events;
  S.sets = sets.filter((s) => s.cards > 0);
  S.sets.forEach((s) => S.setsById.set(s.groupId, s));
  // Optional Duels.ink data: present only in the private build.
  try {
    S.duels = await getJSON("data/duels.json");
    S.duels.cards.forEach((d) => { S.duelsById.set(d.id, d); d.pids.forEach((pid) => S.duelsByPid.set(pid, d)); });
    if (S.duels.decks) {
      S.dcur = S.duels.decks.eras[S.duels.decks.current]; S.dprev = S.duels.decks.eras[S.duels.decks.previous];
      S.view.deckEra = S.duels.decks.current;
      const eraName = Object.fromEntries(S.duels.eras.map((e) => [e.key, e.name]));
      $("deck-era-seg").replaceChildren(...(S.duels.decks.order || [S.duels.decks.current]).map((k) => { const b = el("button", null, eraName[k] || k); b.type = "button"; b.dataset.v = k; return b; }));
    }
    document.querySelectorAll("[data-duels]").forEach((e) => e.hidden = false);
  } catch (e) { S.duels = null; }
  $("updated").textContent = `Preços de ${fmtDate(S.latest)} · ${S.cards.length.toLocaleString("pt-BR")} cartas/impressões · histórico desde ${fmtDate(S.first)}`;
  buildFilters();
  readHash();
  render();
}

/* ---------- multi-select ---------- */
function multiSelect(root, options, selected, allLabel, onChange) {
  const btn = el("button"); btn.type = "button"; btn.setAttribute("aria-haspopup", "true");
  const pop = el("div", "pop"); pop.hidden = true;
  const boxes = options.map(([value, label]) => {
    const lab = el("label"), cb = el("input"); cb.type = "checkbox"; cb.value = value;
    cb.onchange = () => { cb.checked ? selected.add(value) : selected.delete(value); sync(); onChange(); };
    lab.append(cb, document.createTextNode(label)); pop.append(lab); return cb;
  });
  const actions = el("div", "ms-actions");
  const clear = el("button", "link", "Limpar"); clear.type = "button";
  clear.onclick = () => { selected.clear(); sync(); onChange(); };
  const close = el("button", "link", "Fechar"); close.type = "button"; close.onclick = () => { pop.hidden = true; };
  actions.append(clear, close); pop.append(actions);
  btn.onclick = (e) => { e.stopPropagation(); const open = pop.hidden; document.querySelectorAll(".ms .pop").forEach((p) => p.hidden = true); pop.hidden = !open; };
  pop.onclick = (e) => e.stopPropagation();
  root.replaceChildren(btn, pop);
  function sync() {
    boxes.forEach((cb) => cb.checked = selected.has(cb.value));
    const n = selected.size;
    btn.textContent = n === 0 ? allLabel : n === 1 ? options.find(([v]) => selected.has(v))[1] : `${n} selecionadas`;
  }
  sync();
  return { sync };
}
document.addEventListener("click", () => document.querySelectorAll(".ms .pop").forEach((p) => p.hidden = true));

/* ---------- filters ---------- */
function buildFilters() {
  const f = S.filter;
  S.ms.sets = multiSelect($("f-set"), [...S.sets].reverse().map((s) => [String(s.groupId), `${s.name} (${s.abbreviation})`]), f.sets, "Todas", changed);
  const rar = [...new Set(S.cards.map((c) => c.rarity).filter(Boolean))].sort((a, b) => rank(a) - rank(b));
  S.ms.rarities = multiSelect($("f-rarity"), rar.map((r) => [r, r]), f.rarities, "Todas", changed);
  if (S.dcur) S.ms.decks = multiSelect($("f-deck"), [...S.dcur.decks].sort((a, b) => b.games - a.games).map((d) => [d.key, d.name]), f.decks, "Todos", changed);
  $("decks-min").addEventListener("input", (e) => { S.deckMin = +e.target.value || 0; renderDecks(); });
  if (S.duels) S.ms.mechs = multiSelect($("f-mech"), S.duels.mechanics.map((m, i) => [String(i), `${m.group}: ${m.label}`]), f.mechs, "Todas", changed);
  INKS.forEach(([name, color]) => {
    const b = el("button", "ink"); b.type = "button"; b.setAttribute("aria-pressed", "false"); b.dataset.ink = name;
    const dot = el("i"); dot.style.background = color;
    b.append(dot, document.createTextNode(name));
    b.onclick = () => { f.inks.has(name) ? f.inks.delete(name) : f.inks.add(name); changed(); };
    $("f-inks").append(b);
  });
  $("f-from").min = $("f-to").min = S.first; $("f-from").max = $("f-to").max = S.latest;
  const bind = (id, key, ev = "change", map = (v) => v) => $(id).addEventListener(ev, (e) => { f[key] = map(e.target.value); changed(); });
  bind("f-window", "window"); bind("f-from", "from"); bind("f-to", "to"); bind("f-format", "format");
  bind("f-printing", "printing"); bind("f-min", "min", "input", (v) => +v || 0);
  bind("f-q", "q", "input", (v) => v.trim().toLowerCase());
  $("f-reset").onclick = () => {
    Object.assign(f, { format: "", printing: "", min: 0, q: "" }); f.sets.clear(); f.inks.clear(); f.rarities.clear(); f.mechs.clear(); f.decks.clear();
    changed();
  };
  document.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => { S.tab = b.dataset.tab; changed(); });
  $("pg-prev").onclick = () => { S.page = Math.max(0, S.page - 1); renderCards(); };
  $("pg-next").onclick = () => { S.page++; renderCards(); };
  $("mp-prev").onclick = () => { S.metaPage = Math.max(0, S.metaPage - 1); renderMeta(); };
  $("mp-next").onclick = () => { S.metaPage++; renderMeta(); };
  // view controls (segmented buttons + event checkboxes); they don't change the filter, only the chart
  document.querySelectorAll(".seg[data-ctl]").forEach((g) => g.querySelectorAll("button").forEach((b) => b.onclick = () => {
    S.view[g.dataset.ctl] = b.dataset.v; syncView(); writeHash();
    if (g.dataset.ctl === "gran") renderDetailChart(); else if (g.closest("#detail")) renderDetailChart(); else render();
  }));
  document.querySelectorAll("input[data-ev]").forEach((cb) => cb.onchange = () => {
    S.view.ev[cb.dataset.ev] = cb.checked; syncView(); writeHash();
    if (cb.closest("#detail")) renderDetailChart(); else renderEvolution();
  });
}

function syncControls() {
  const f = S.filter;
  $("f-window").value = f.window; $("f-from").value = f.from; $("f-to").value = f.to; $("f-format").value = f.format;
  $("f-printing").value = f.printing; $("f-min").value = f.min; $("f-q").value = f.q;
  S.ms.sets.sync(); S.ms.rarities.sync(); if (S.ms.mechs) S.ms.mechs.sync(); if (S.ms.decks) S.ms.decks.sync();
  document.querySelectorAll(".ink").forEach((b) => b.setAttribute("aria-pressed", f.inks.has(b.dataset.ink)));
  document.querySelector(".custom-range").hidden = f.window !== "custom";
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === S.tab));
  document.querySelectorAll(".tab").forEach((t) => t.hidden = t.id !== "tab-" + S.tab);
  syncView();
}
function syncView() {
  document.querySelectorAll(".seg[data-ctl]").forEach((g) => g.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", S.view[g.dataset.ctl] === b.dataset.v)));
  document.querySelectorAll("input[data-ev]").forEach((cb) => cb.checked = S.view.ev[cb.dataset.ev]);
}

function writeHash() {
  const f = S.filter, v = S.view, p = new URLSearchParams();
  if (S.tab !== "overview") p.set("tab", S.tab);
  if (f.window !== "d30") p.set("w", f.window);
  if (f.window === "custom") { p.set("from", f.from); p.set("to", f.to); }
  if (f.format) p.set("fmt", f.format);
  if (f.sets.size) p.set("set", [...f.sets].join(","));
  if (f.inks.size) p.set("ink", [...f.inks].join(","));
  if (f.rarities.size) p.set("rar", [...f.rarities].join(","));
  if (f.mechs.size) p.set("mech", [...f.mechs].join(","));
  if (f.decks.size) p.set("deck", [...f.decks].join(","));
  if (f.printing) p.set("pr", f.printing);
  if (f.min) p.set("min", f.min);
  if (f.q) p.set("q", f.q);
  if (v.evoMetric !== "total") p.set("evo", v.evoMetric);
  if (v.group !== "set") p.set("grp", v.group);
  if (v.distMetric !== "total") p.set("dm", v.distMetric);
  if (v.chgGroup !== "ink") p.set("cg", v.chgGroup);
  if (!v.ev.rel) p.set("norel", 1);
  if (!v.ev.rot) p.set("norot", 1);
  try { history.replaceState(null, "", p.toString() ? "#" + p : location.pathname); } catch (e) { /* sandboxed frame */ }
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1)), f = S.filter, v = S.view;
  const list = (k) => (p.get(k) || "").split(",").filter(Boolean);
  S.tab = p.get("tab") || "overview";
  f.window = p.get("w") || "d30"; f.from = p.get("from") || ""; f.to = p.get("to") || "";
  f.format = p.get("fmt") || "";
  f.sets.clear(); list("set").forEach((x) => f.sets.add(x));
  f.inks.clear(); list("ink").forEach((x) => f.inks.add(x));
  f.rarities.clear(); list("rar").forEach((x) => f.rarities.add(x));
  f.mechs.clear(); if (S.duels) list("mech").forEach((x) => f.mechs.add(x));
  f.decks.clear(); if (S.dcur) list("deck").forEach((x) => f.decks.add(x));
  f.printing = p.get("pr") || ""; f.min = +(p.get("min") || 0); f.q = p.get("q") || "";
  v.evoMetric = p.get("evo") || "total"; v.group = p.get("grp") || "set"; v.distMetric = p.get("dm") || "total"; v.chgGroup = p.get("cg") || "ink";
  v.ev.rel = !p.get("norel"); v.ev.rot = !p.get("norot");
  if (f.window === "custom" && !f.from) { f.from = addDays(S.latest, -30); f.to = S.latest; }
  syncControls();
}

let pending = 0;
async function changed() {
  const f = S.filter;
  if (f.window === "custom" && (!f.from || !f.to)) { f.from = f.from || addDays(S.latest, -30); f.to = f.to || S.latest; }
  S.page = 0; syncControls(); writeHash();
  const my = ++pending;
  if (f.window === "custom") {
    document.querySelector("main").style.opacity = 0.6;
    await loadHistories(selectedSetIds());
    if (my !== pending) return;
    document.querySelector("main").style.opacity = 1;
  }
  render();
}
function addDays(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function selectedSetIds() { return S.filter.sets.size ? [...S.filter.sets].map(Number) : S.sets.map((s) => s.groupId); }

function passes(c) {
  const f = S.filter;
  if (f.format === "core" && !c.core) return false;
  if (f.format === "core-strict" && !(c.core && /^\d+$/.test(c.setCode || "") && +c.setCode >= (S.events.coreMinSet || 9))) return false;
  if (f.format === "infinity" && !c.inf) return false;
  if (f.sets.size && !f.sets.has(String(c.set))) return false;
  if (f.inks.size && !inkList(c).some((i) => f.inks.has(i))) return false;
  if (f.rarities.size && !f.rarities.has(c.rarity)) return false;
  if (f.mechs.size) { const d = duelsOf(c); if (!d || !d.m.some((i) => f.mechs.has(String(i)))) return false; }
  if (f.decks.size && S.dcur) { const d = duelsOf(c); if (!d || !selectedDeckCards().has(d.id)) return false; }
  if (f.printing && c.printing !== f.printing) return false;
  if (f.min && !(c.price >= f.min)) return false;
  if (f.q && !c.name.toLowerCase().includes(f.q)) return false;
  return true;
}

/* ---------- history ---------- */
function loadHistory(gid) {
  if (!S.histories.has(gid)) S.histories.set(gid, getJSON(`data/history/${gid}.json`).then((h) => { h.days = h.dates.map(day); return h; }));
  return S.histories.get(gid);
}
async function loadHistories(gids) { const hs = await Promise.all(gids.map(loadHistory)); gids.forEach((g, i) => S.histories.set(g, hs[i])); return hs; }
const histNow = (gid) => { const h = S.histories.get(gid); return h && !(h instanceof Promise) ? h : null; };

function priceAt(h, key, iso) {
  const arr = h.s[key]; if (!arr) return null;
  const target = day(iso);
  let i = h.dates.length - 1;
  while (i >= 0 && h.days[i] > target) i--;
  for (let k = i; k >= 0 && target - h.days[k] <= CARRY_DAYS; k--) if (arr[k]) return arr[k];
  return null;
}

/** Window change for a card: {then, now, pct} */
function change(c) {
  const f = S.filter;
  if (f.window === "all") return { now: c.price, then: c.first ? c.first[1] : null, pct: c.ch.all };
  if (f.window !== "custom") {
    const p = c.ch[f.window];
    return { now: c.price, pct: p, then: p == null || !c.price ? null : c.price / (1 + p / 100) };
  }
  const h = histNow(c.set);
  if (!h) return { now: null, then: null, pct: null };
  const then = priceAt(h, c.id, f.from), now = priceAt(h, c.id, f.to);
  return { then, now, pct: then && now ? Math.round((now / then - 1) * 1000) / 10 : null };
}
function windowText() {
  const f = S.filter;
  return f.window === "custom" ? `${fmtDate(f.from)} → ${fmtDate(f.to)}` : WINDOW_LABEL[f.window];
}

/* ---------- render ---------- */
function render() {
  S.rows = S.cards.filter(passes);
  if (S.tab === "overview") renderOverview(S.rows);
  if (S.tab === "movers") renderMovers(S.rows);
  if (S.tab === "cards") renderCards();
  if (S.tab === "meta") { S.metaPage = 0; renderMeta(); }
  if (S.tab === "decks") renderDecks();
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

  renderDistribution(priced);
  renderRarity(priced);
  renderInkRank(priced);
  renderEvolution();
}

function renderDistribution(priced) {
  const { group, distMetric } = S.view, avg = distMetric === "avg";
  const agg = (list) => { const s = list.reduce((a, c) => a + c.price, 0); return avg ? (list.length ? s / list.length : null) : s; };
  const r2 = (v) => v == null ? null : Math.round(v * 100) / 100;
  const setsIn = S.sets.filter((s) => priced.some((c) => c.set === s.groupId)).reverse();
  const inksIn = [...INKS, DUAL].map(([n]) => n).filter((n) => priced.some((c) => inkGroup(c) === n));
  const metricTxt = avg ? "Preço médio" : "Valor total";
  $("dist-title").textContent = `${metricTxt} por ${group === "set" ? "coleção" : group === "ink" ? "tinta" : group === "mech" ? "mechanic" : "coleção e tinta"}`;
  const wrap = $("dist-wrap");
  if (group === "set") {
    wrap.style.height = Math.max(300, setsIn.length * 24 + 60) + "px";
    const vals = setsIn.map((s) => agg(priced.filter((c) => c.set === s.groupId)));
    $("dist-note").textContent = avg ? "Média do market price das cartas no filtro, por coleção." : "Soma do market price de uma cópia de cada carta e impressão no filtro.";
    barChart("c-dist", setsIn.map((s) => s.name), [{ data: vals.map(r2) }], {
      horizontal: true,
      tooltip: (i) => { const n = priced.filter((c) => c.set === setsIn[i].groupId).length; return [usd0(vals[i]), `${n} cartas · lançada em ${fmtDate(setsIn[i].publishedOn)}`]; },
      onClick: (i) => filterBy("set", setsIn[i].groupId),
    });
  } else if (group === "mech" && S.duels) {
    const ks = [...new Set(priced.flatMap(mechKeys))].sort((a, b) => a - b);
    wrap.style.height = Math.max(300, ks.length * 24 + 60) + "px";
    const lists = ks.map((k) => priced.filter((c) => mechKeys(c).includes(k)));
    const vals = lists.map(agg);
    $("dist-note").textContent = "Classificação \"mechanic\" do Duels.ink. Uma carta com várias mechanics entra em todas as barras correspondentes.";
    barChart("c-dist", ks.map(mechLabel), [{ data: vals.map(r2) }], {
      horizontal: true, tooltip: (i) => [usd0(vals[i]), `${lists[i].length} cartas`], onClick: (i) => filterBy("mech", ks[i]),
    });
  } else if (group === "ink") {
    wrap.style.height = "380px";
    const vals = inksIn.map((n) => agg(priced.filter((c) => inkGroup(c) === n)));
    $("dist-note").textContent = "Cartas de duas tintas ficam numa barra própria. Use o filtro de coleção para comparar coleções específicas.";
    barChart("c-dist", inksIn, [{ data: vals.map(r2), backgroundColor: inksIn.map((n) => INK_COLOR[n]) }], {
      horizontal: true,
      tooltip: (i) => [usd0(vals[i]), `${priced.filter((c) => inkGroup(c) === inksIn[i]).length} cartas`],
      onClick: (i) => filterBy("ink", inksIn[i]),
    });
  } else {
    wrap.style.height = Math.max(340, setsIn.length * (avg ? 46 : 24) + 90) + "px";
    $("dist-note").textContent = avg ? "Preço médio de cada tinta dentro de cada coleção (barras lado a lado)." : "Valor total de cada coleção dividido por tinta (barras empilhadas).";
    const datasets = inksIn.map((n) => ({
      label: n, backgroundColor: INK_COLOR[n],
      data: setsIn.map((s) => r2(agg(priced.filter((c) => c.set === s.groupId && inkGroup(c) === n)))),
    }));
    barChart("c-dist", setsIn.map((s) => s.name), datasets, {
      horizontal: true, stacked: !avg, legend: true,
      tooltip: (i, ds) => `${datasets[ds].label}: ${usd0(datasets[ds].data[i])}`,
      onClick: (i, ds) => filterBy("setink", [setsIn[i].groupId, datasets[ds].label]),
    });
  }
}

function renderRarity(priced) {
  const byR = new Map();
  priced.forEach((c) => { const r = c.rarity || "—"; if (!byR.has(r)) byR.set(r, []); byR.get(r).push(c.price); });
  const rk = [...byR.keys()].sort((a, b) => rank(a) - rank(b));
  const stats = rk.map((r) => { const v = byR.get(r).sort((a, b) => a - b); return { avg: v.reduce((a, b) => a + b, 0) / v.length, med: v[Math.floor(v.length / 2)], n: v.length }; });
  const avgs = stats.map((s) => s.avg);
  barChart("c-rarity", rk, [{ data: avgs.map((v) => Math.round(v * 100) / 100) }], {
    log: avgs.length > 1 && Math.max(...avgs) / Math.max(0.01, Math.min(...avgs)) > 50,
    tooltip: (i) => [`Média ${usd(stats[i].avg)}`, `Mediana ${usd(stats[i].med)} · ${stats[i].n} cartas`],
    onClick: (i) => filterBy("rarity", rk[i]),
  });
}

/** Clicking a bar filters by it; clicking the same bar again (when it's the only selection) clears it. */
function filterBy(kind, key) {
  const f = S.filter;
  const toggle = (set, v) => { const only = set.size === 1 && set.has(v); set.clear(); if (!only) set.add(v); };
  if (kind === "set") toggle(f.sets, String(key));
  else if (kind === "rarity") { if (key && key !== "—") toggle(f.rarities, key); }
  else if (kind === "ink") { if (key === DUAL[0]) return; toggle(f.inks, key); }
  else if (kind === "mech") toggle(f.mechs, String(key));
  else if (kind === "setink") { f.sets.clear(); f.sets.add(String(key[0])); if (key[1] !== DUAL[0]) { f.inks.clear(); f.inks.add(key[1]); } }
  changed();
}

function renderInkRank(priced) {
  const root = $("ink-rank"); root.replaceChildren();
  INKS.forEach(([ink, color]) => {
    const col = el("div", "ink-col"), h = el("h3"), dot = el("i"); dot.style.background = color;
    h.append(dot, document.createTextNode(ink)); col.append(h);
    const top = priced.filter((c) => inkList(c).includes(ink)).sort((a, b) => b.price - a.price).slice(0, 5);
    const ol = el("ol");
    if (!top.length) ol.append(el("li", "muted", "Nenhuma carta no filtro"));
    top.forEach((c, i) => {
      const li = el("li"); li.tabIndex = 0;
      li.onclick = li.onkeydown = (e) => { if (e.type === "click" || e.key === "Enter") openDetail(c); };
      const im = new Image(); im.loading = "lazy"; im.alt = ""; if (c.img) im.src = c.img;
      const nm = el("div", null, `${i + 1}. ${c.name}`);
      nm.append(el("small", null, [c.setCode && (/^\d+$/.test(c.setCode) ? "S" + c.setCode : c.setCode), c.rarity, c.printing !== "Normal" ? c.printing : ""].filter(Boolean).join(" · ")));
      nm.append(el("b", null, usd0(c.price)));
      li.append(im, nm); ol.append(li);
    });
    col.append(ol); root.append(col);
  });
}

let evoToken = 0;
async function renderEvolution() {
  const my = ++evoToken, rows = S.rows;
  const gids = [...new Set(rows.map((c) => c.set))];
  const canvas = $("c-evo"); canvas.style.opacity = 0.5;
  const hs = await loadHistories(gids.length ? gids : [S.sets[0].groupId]);
  if (my !== evoToken) return;
  canvas.style.opacity = 1;
  const base = hs[0], n = base.dates.length;
  const sum = new Float64Array(n), cnt = new Uint32Array(n);
  rows.forEach((c) => {
    const h = histNow(c.set), arr = h && h.s[c.id]; if (!arr) return;
    let last = null, lastDay = -1e9;
    for (let i = 0; i < n; i++) {
      if (arr[i]) { last = arr[i]; lastDay = h.days[i]; }
      if (last != null && h.days[i] - lastDay <= CARRY_DAYS) { sum[i] += last; cnt[i]++; }
    }
  });
  const avg = S.view.evoMetric === "avg";
  const vals = [...sum].map((s, i) => cnt[i] ? Math.round((avg ? s / cnt[i] : s) * 100) / 100 : null);
  $("evo-note").textContent = (avg
    ? "Preço médio das cartas no filtro em cada data. A média muda também quando entram coleções novas."
    : "Soma dos preços das cartas no filtro em cada data. Sobe também quando entram coleções novas.") + " Semanal até 90 dias atrás, diário depois.";
  lineChart("c-evo", base.dates, vals, avg ? "Preço médio" : "Valor total", { counts: [...cnt] });
}

function renderMovers(rows) {
  const list = rows.map((c) => ({ c, x: change(c) })).filter((o) => o.x.pct != null && o.x.now >= MOVERS_MIN_PRICE);
  const up = list.filter((o) => o.x.pct > 0).sort((a, b) => b.x.pct - a.x.pct).slice(0, 25);
  const down = list.filter((o) => o.x.pct < 0).sort((a, b) => a.x.pct - b.x.pct).slice(0, 25);
  const extra = S.filter.window === "all" ? " \"Antes\" é o preço 1 semana após o lançamento da carta (ou o de fev/2024, início do histórico, para coleções mais antigas). Cartas lançadas há menos de uma semana ficam de fora." : "";
  $("movers-note").textContent = `Janela: ${windowText()}. Só cartas com preço atual a partir de ${usd(MOVERS_MIN_PRICE)}, para evitar ruído de cartas de centavos. ${list.length} cartas com preço nas duas datas.${extra}`;
  moverTable($("t-up"), up); moverTable($("t-down"), down);
  renderGroupChange(rows);
}

/** Change of the summed value of each group (ink / rarity / set) over the selected window. */
function renderGroupChange(rows) {
  const g = S.view.chgGroup;
  const keysOf = g === "ink" ? (c) => [inkGroup(c)] : g === "rarity" ? (c) => [c.rarity] : g === "mech" ? mechKeys : (c) => [c.set];
  const acc = new Map();
  rows.forEach((c) => {
    const x = change(c); if (!x.now || !x.then) return;
    keysOf(c).forEach((k) => {
      if (k == null) return;
      if (!acc.has(k)) acc.set(k, { now: 0, then: 0, pcts: [] });
      const a = acc.get(k); a.now += x.now; a.then += x.then; a.pcts.push((x.now / x.then - 1) * 100);
    });
  });
  let keys = [...acc.keys()];
  if (g === "ink") keys = [...INKS, DUAL].map(([n]) => n).filter((n) => acc.has(n));
  else if (g === "rarity") keys.sort((a, b) => rank(a) - rank(b));
  else if (g === "mech") keys.sort((a, b) => a - b);
  else keys = S.sets.map((s) => s.groupId).filter((id) => acc.has(id)).reverse();
  const label = (k) => g === "set" ? (S.setsById.get(k)?.name || k) : g === "mech" ? mechLabel(k) : k;
  const stats = keys.map((k) => { const a = acc.get(k), v = a.pcts.sort((x, y) => x - y);
    return { pct: Math.round((a.now / a.then - 1) * 1000) / 10, med: v[Math.floor(v.length / 2)], n: v.length, now: a.now, then: a.then }; });
  // largest change on top
  const ord = stats.map((st, i) => i).sort((a, b) => stats[b].pct - stats[a].pct);
  keys = ord.map((i) => keys[i]); const sorted = ord.map((i) => stats[i]); stats.length = 0; stats.push(...sorted);
  $("grpchg-title").textContent = "Variação por " + (g === "ink" ? "tinta" : g === "rarity" ? "raridade" : g === "mech" ? "mechanic" : "coleção");
  $("grpchg-note").textContent = `Quanto variou o valor somado das cartas de cada grupo na janela (${windowText()}), contando só cartas com preço nas duas datas. A mediana da variação por carta aparece ao passar o mouse.`;
  $("grpchg-wrap").style.height = Math.max(260, keys.length * 30 + 60) + "px";
  const pos = css("--series-1"), neg = css("--critical");
  barChart("c-grpchg", keys.map(label), [{ data: stats.map((s) => s.pct), backgroundColor: stats.map((s) => s.pct >= 0 ? pos : neg), borderSkipped: false }], {
    horizontal: true, fmt: (v) => (v > 0 ? "+" : "") + Number(v).toLocaleString("pt-BR") + "%",
    onClick: (i) => filterBy(g, keys[i]),
    tooltip: (i) => [`Valor somado: ${pctTxt(stats[i].pct)}`, `${usd0(stats[i].then)} → ${usd0(stats[i].now)}`,
      `Mediana por carta: ${pctTxt(Math.round(stats[i].med * 10) / 10)} · ${stats[i].n} cartas`],
  });
}

function moverTable(tbl, items) {
  tbl.replaceChildren();
  const head = tbl.createTHead().insertRow();
  [["", ""], ["Carta", ""], ["Antes", "num"], ["Agora", "num"], ["Variação", "num"]].forEach(([t, cl]) => { const th = el("th", cl, t); head.append(th); });
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

function imgCell(tr, c) { const td = tr.insertCell(); if (c.img) { const im = new Image(); im.loading = "lazy"; im.onerror = () => { im.style.visibility = "hidden"; }; im.src = c.img; im.alt = ""; td.append(im); } }
function nameCell(tr, c) {
  const td = tr.insertCell(); td.className = "name"; td.append(document.createTextNode(c.name));
  const sm = el("small", null, [S.setsById.get(c.set)?.name, c.num, c.rarity, c.ink && c.ink.replace(";", "/"), c.printing !== "Normal" ? c.printing : ""].filter(Boolean).join(" · "));
  if (c.core) sm.append(el("span", "badge", "Core"));
  if (c.inf) sm.append(el("span", "badge", "Infinity"));
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
    const th = el("th", ["price", "low", "chg"].includes(k) ? "num" : "", t);
    if (f) {
      th.tabIndex = 0; if (S.sort.key === k) th.setAttribute("aria-sort", S.sort.dir < 0 ? "descending" : "ascending");
      th.onclick = th.onkeydown = (e) => { if (e.type === "click" || e.key === "Enter") { S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : (k === "name" ? 1 : -1) }; renderCards(); } };
    }
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
  const di = $("d-img"); di.style.visibility = "visible"; di.onerror = () => { di.style.visibility = "hidden"; };
  di.src = c.img ? c.img.replace("_200w", "_400w") : ""; di.alt = c.name;
  $("d-name").textContent = c.name;
  $("d-meta").textContent = [S.setsById.get(c.set)?.name, c.num, c.rarity, c.ink && c.ink.replace(";", "/"), c.type, c.cost ? `custo ${c.cost}` : "", c.printing,
    c.core ? "Core e Infinity" : c.inf ? "Só Infinity" : "Fora dos formatos"].filter(Boolean).join(" · ");
  $("d-link").href = c.url || "#";
  const k = $("d-kpis"); k.replaceChildren();
  const add = (label, val, cls = "") => { const d = el("div", "kpi"); d.append(el("span", "kpi-label", label), el("span", "kpi-value " + cls, val)); k.append(d); };
  add("Market price", usd(c.price)); add("Menor anúncio", usd(c.low));
  [["d7", "7 dias"], ["d30", "30 dias"], ["d365", "1 ano"]].forEach(([w, l]) => { const v = c.ch[w]; add(l, pctTxt(v), v > 0 ? "up" : v < 0 ? "down" : ""); });
  const va = c.ch.all;
  add(c.first ? `Desde o lançamento (${usd(c.first[1])})` : "Desde o lançamento", pctTxt(va), va > 0 ? "up" : va < 0 ? "down" : "");
  $("d-note").textContent = c.first
    ? `Base do "desde o lançamento": ${usd(c.first[1])} em ${fmtDate(c.first[0])}${c.first[0] === S.first ? " (início do nosso histórico; a carta é anterior a fev/2024)" : " (primeiro preço a partir de 1 semana após o lançamento, para não pegar a euforia da estreia)"}. No modo mensal, o primeiro ponto é o primeiro preço registrado e os demais são o último preço de cada mês.`
    : "Ainda não há preço de 1 semana após o lançamento desta carta. No modo mensal, cada ponto é o último preço do mês.";
  renderDetailDuels(c);
  $("detail").showModal();
  await loadHistories([c.set]);
  renderDetailChart();
}
function renderDetailChart() {
  syncView();
  const c = S.detail; if (!c) return;
  const h = histNow(c.set); if (!h) return;
  let dates = h.dates, vals = h.s[c.id] || [];
  if (S.view.gran === "monthly") {
    // first recorded price + the last recorded price of every month (plotted on its real date)
    const keep = new Map(); let firstIdx = -1;
    dates.forEach((d, i) => { if (!vals[i]) return; if (firstIdx < 0) firstIdx = i; keep.set(d.slice(0, 7), i); });
    const idx = firstIdx < 0 ? [] : [...new Set([firstIdx, ...keep.values()])].sort((a, b) => a - b);
    dates = idx.map((i) => dates[i]); vals = idx.map((i) => vals[i]);
  }
  lineChart("c-detail", dates, vals, "Preço");
}

/* ---------- Duels.ink (private build only) ---------- */
function duelsOf(c) { return S.duels ? S.duelsByPid.get(c.pid) || null : null; }
function mechKeys(c) { const d = duelsOf(c); return d ? d.m : []; }
function mechLabel(i) { const m = S.duels && S.duels.mechanics[i]; return m ? m.label : String(i); }
const pct1 = (v) => v == null ? "–" : (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
const num2 = (v) => v == null ? "–" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function renderDetailDuels(c) {
  const box = $("d-duels"), d = duelsOf(c);
  box.replaceChildren(); box.hidden = !d;
  if (!d) return;
  box.append(el("h3", null, "Uso no ranqueado Core (Duels.ink)"));
  if (d.m.length) box.append(el("p", "muted small", "Mechanics: " + d.m.map(mechLabel).join(" · ")));
  const t = el("table", "t"), hr = t.createTHead().insertRow();
  ["Expansão", "Cópias/deck", "Presença", "Vitória c/ ela na mão inicial", "Mantida no mulligan"].forEach((h, i) => hr.append(el("th", i ? "num" : "", h)));
  const b = t.createTBody();
  S.duels.eras.forEach((e, i) => {
    const u = d.u[i], tr = b.insertRow();
    tr.style.cursor = "default";
    tr.insertCell().textContent = e.name;
    [u && num2(u[0]), u && pct1(u[1]), u && pct1(u[2]), u && pct1(u[3])].forEach((v) => numCell(tr, v || "–"));
  });
  box.append(t, el("p", "muted small", "Cópias/deck é um índice relativo (as partidas sem arquétipo identificado ficam de fora). Presença = fração dos decks cujo arquétipo usa a carta."));
}

/* Decks selected by the filters: explicit deck filter wins; otherwise ink filter
   (1 ink = decks containing it; 2+ inks = decks whose colors are all among them); otherwise all. */
function deckPred() {
  const f = S.filter;
  if (f.decks.size) return (d) => f.decks.has(d.key);
  if (f.inks.size === 1) { const ink = [...f.inks][0]; return (d) => d.colors.includes(ink); }
  if (f.inks.size > 1) return (d) => d.colors.every((c) => f.inks.has(c));
  return () => true;
}
function deckScopeText() {
  const f = S.filter;
  if (f.decks.size) return f.decks.size === 1 ? S.dcur.decks.find((d) => f.decks.has(d.key))?.name || "deck selecionado" : `${f.decks.size} decks selecionados`;
  if (f.inks.size === 1) return `decks com ${[...f.inks][0]}`;
  if (f.inks.size > 1) return `decks ${[...f.inks].join("/")}`;
  return "todos os decks";
}
let deckCardsCache = { key: "", set: new Set() };
function selectedDeckCards() {
  const key = [...S.filter.decks].sort().join(",");
  if (deckCardsCache.key !== key) {
    const set = new Set();
    S.dcur.decks.filter((d) => S.filter.decks.has(d.key)).forEach((d) => Object.keys(d.list).forEach((c) => set.add(c)));
    deckCardsCache = { key, set };
  }
  return deckCardsCache.set;
}
/** Per-card usage within the decks that match pred: copies/deck (index), share of decks listing it, opener win rate. */
function usageFor(era, pred) {
  const decks = era.decks.filter(pred), G = decks.reduce((a, d) => a + d.games, 0);
  const shareG = new Map(), n = new Map(), w = new Map();
  decks.forEach((d) => {
    Object.keys(d.list).forEach((c) => shareG.set(c, (shareG.get(c) || 0) + d.games));
    Object.entries(d.open).forEach(([c, [k, won]]) => { n.set(c, (n.get(c) || 0) + k); w.set(c, (w.get(c) || 0) + won); });
  });
  const out = new Map();
  new Set([...shareG.keys(), ...n.keys()]).forEach((c) => {
    const k = n.get(c) || 0;
    out.set(c, { copies: G ? k / G * 60 / 7 : 0, share: G ? (shareG.get(c) || 0) / G : 0, wr: k ? (w.get(c) || 0) / k : null });
  });
  return { G, decks: decks.length, byCard: out };
}

function renderMeta() {
  if (!S.duels || !S.dcur) return;
  const eras = S.duels.eras, curEra = eras[eras.length - 1];
  const pred = deckPred(), cur = usageFor(S.dcur, pred), prev = S.dprev ? usageFor(S.dprev, pred) : null;
  // one row per Duels.ink card: its Normal printing (or the cheapest one) for price
  const byCard = new Map();
  S.rows.forEach((c) => { const d = duelsOf(c); if (!d) return; const u = cur.byCard.get(d.id); if (!u || (u.copies < 0.005 && u.share === 0)) return;
    const have = byCard.get(d); if (!have || (c.printing === "Normal" && have.printing !== "Normal") || (have.printing !== "Normal" && c.price < have.price)) byCard.set(d, c); });
  const gids = [...new Set([...byCard.values()].map((c) => c.set))];
  if (!gids.every((g) => histNow(g))) { $("meta-note").textContent = "Carregando histórico de preços…"; loadHistories(gids).then(() => S.tab === "meta" && renderMeta()); return; }
  const since = (c, iso) => { const h = histNow(c.set), then = h && priceAt(h, c.id, iso); return then && c.price ? Math.round((c.price / then - 1) * 1000) / 10 : null; };
  const rows = [...byCard].map(([d, c]) => {
    const u = cur.byCard.get(d.id), p = prev && prev.byCard.get(d.id);
    return { c, d, use: u.copies, share: u.share, wr: u.wr, dUse: p ? u.copies - p.copies : null,
      pxCur: since(c, curEra.start), pxWin: change(c).pct };
  });
  const cols = [
    ["img", ""], ["name", "Carta"], ["use", `Cópias/deck (${curEra.name})`], ["dUse", "Δ vs Set 13"],
    ["share", "Presença"], ["wr", "Vitória na mão inicial"], ["price", "Preço"],
    ["pxCur", `Preço desde início da ${curEra.name}`], ["pxWin", `Preço: ${windowText()}`],
  ];
  const val = (r, k) => k === "name" ? r.c.name : k === "price" ? r.c.price : r[k];
  const { key, dir } = S.metaSort;
  rows.sort((a, b) => { const x = val(a, key), y = val(b, key);
    if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return (x > y ? 1 : x < y ? -1 : 0) * dir; });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); S.metaPage = Math.min(S.metaPage, pages - 1);
  $("mp-info").textContent = `${S.metaPage + 1} / ${pages}`;
  $("meta-count").textContent = `· ${rows.length} cartas · uso em ${deckScopeText()}`;
  $("meta-note").textContent = `Uso no ranqueado Core BO1 do Duels.ink em ${deckScopeText()} (${cur.decks} decks, ${Math.round(cur.G / 2).toLocaleString("pt-BR")} partidas na ${curEra.name}). Presença = fração desses decks cuja lista usa a carta. Filtrar tinta ou deck muda a base do cálculo. Uma linha por carta, com o preço da impressão normal; a última coluna segue a janela escolhida.`;
  const tbl = $("t-meta"); tbl.replaceChildren();
  const hr = tbl.createTHead().insertRow();
  cols.forEach(([k, t]) => { const th = el("th", ["img", "name"].includes(k) ? "" : "num", t);
    if (k !== "img") { th.tabIndex = 0; if (key === k) th.setAttribute("aria-sort", dir < 0 ? "descending" : "ascending");
      th.onclick = th.onkeydown = (e) => { if (e.type === "click" || e.key === "Enter") { S.metaSort = { key: k, dir: key === k ? -dir : (k === "name" ? 1 : -1) }; renderMeta(); } }; }
    hr.append(th); });
  const body = tbl.createTBody();
  rows.slice(S.metaPage * PAGE, S.metaPage * PAGE + PAGE).forEach((r) => {
    const tr = body.insertRow(); tr.tabIndex = 0;
    tr.onclick = tr.onkeydown = (e) => { if (e.type === "click" || e.key === "Enter") openDetail(r.c); };
    imgCell(tr, r.c); nameCell(tr, r.c);
    numCell(tr, num2(r.use));
    const du = numCell(tr, r.dUse == null ? "novo" : (r.dUse > 0 ? "+" : "") + num2(r.dUse)); if (r.dUse) du.className += r.dUse > 0 ? " up" : " down";
    numCell(tr, pct1(r.share)); numCell(tr, pct1(r.wr)); numCell(tr, usd(r.c.price));
    [r.pxCur, r.pxWin].forEach((v) => { const td = numCell(tr, pctTxt(v)); if (v) td.className += v > 0 ? " up" : " down"; });
  });
}

/* ---------- Decks tab ---------- */
let priceByCidCache = null;
function cardForCid(cid) {
  if (!priceByCidCache) {
    priceByCidCache = new Map();
    S.cards.forEach((c) => { const d = duelsOf(c); if (!d || !c.price) return; const have = priceByCidCache.get(d.id);
      if (!have || (c.printing === "Normal" && have.printing !== "Normal") || (have.printing !== "Normal" && c.price < have.price)) priceByCidCache.set(d.id, c); });
  }
  return priceByCidCache.get(cid) || null;
}
function deckCost(d) { let t = 0, missing = 0; Object.entries(d.list).forEach(([cid, cp]) => { const n = Math.round(cp); if (!n) return; const c = cardForCid(cid); if (c) t += n * c.price; else missing++; }); return { t, missing }; }
function inkDots(colors) { const sp = el("span"); colors.forEach((c) => { const i = el("i"); i.style.cssText = `display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:3px;background:${INK_COLOR[c] || "#999"}`; sp.append(i); }); return sp; }
const wrClass = (w) => w > 0.52 ? " up" : w < 0.48 ? " down" : "";

function eraOrder() { return (S.duels.decks.order || [S.duels.decks.current]); }
function eraInfo(k) { return S.duels.eras.find((e) => e.key === k) || { key: k, name: k }; }
function deckEraData(k) { return S.duels.decks.eras[k]; }
function prevEraKey(k) { const o = eraOrder(), i = o.indexOf(k); return i > 0 ? o[i - 1] : null; }

function renderDecks() {
  if (!S.dcur) return;
  syncView();
  const ek = S.view.deckEra || S.duels.decks.current, era = deckEraData(ek), pk = prevEraKey(ek), prev = pk && deckEraData(pk);
  const total = era.totalGames, pred = deckPred(), byColors = S.view.deckView === "colors";
  const tbl = $("t-decks"); tbl.replaceChildren();
  const f = S.filter;
  let rows;
  if (byColors) {
    const prevBy = new Map((prev ? prev.colorPairs : []).map((p) => [p.colors.join("/"), p]));
    rows = era.colorPairs.filter((p) => p.games >= S.deckMin && (!f.inks.size || p.colors.some((c) => f.inks.has(c))))
      .map((p) => { const q = prevBy.get(p.colors.join("/")); const play = p.games / (2 * total), wr = p.wins / p.games;
        return { key: p.colors.join("/"), name: p.colors.join("/"), colors: p.colors, games: p.games, play, wr,
          dPlay: q ? play - q.games / (2 * prev.totalGames) : null, dWr: q ? wr - q.wins / q.games : null }; });
  } else {
    const prevBy = new Map((prev ? prev.decks : []).map((d) => [d.key, d]));
    rows = era.decks.map((d) => { const q = prevBy.get(d.key), play = d.games / (2 * total), wr = d.wins / d.games, named = !d.key.endsWith("|outros");
        return { key: d.key, d, name: d.name, colors: d.colors, games: d.games, play, wr, cost: deckCost(d).t,
          dPlay: q && named ? play - q.games / (2 * prev.totalGames) : null, dWr: q && named ? wr - q.wins / q.games : null }; })
      .filter((r) => r.games >= S.deckMin && (f.decks.size ? true : pred(r.d)));
  }
  const pn = pk ? eraInfo(pk).name : null;
  const cols = [["rank", "#"], ["name", byColors ? "Cores" : "Deck"], ["games", "Partidas"], ["play", "Presença"]]
    .concat(pk ? [["dPlay", `Δ presença vs ${pn}`]] : []).concat([["wr", "Win rate"]]).concat(pk ? [["dWr", `Δ win rate vs ${pn}`]] : [])
    .concat(byColors ? [] : [["cost", "Custo da lista"]]);
  const { key, dir } = S.deckSort;
  const sk = cols.some((c) => c[0] === key) && key !== "rank" ? key : "wr";
  rows.sort((a, b) => { const x = a[sk], y = b[sk]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return (x > y ? 1 : x < y ? -1 : 0) * (sk === key ? dir : -1); });
  $("decks-count").textContent = `· ${rows.length} ${byColors ? "combinações" : "decks"} · ${eraInfo(ek).name}`;
  $("decks-note").textContent = (byColors
    ? "Win rate de cada combinação de tintas no ranqueado Core BO1 do Duels.ink. Clique numa linha para filtrar essas tintas e ver os decks delas."
    : "Decks do Duels.ink (arquétipos; builds com o mesmo nome somadas). Custo da lista = cópias típicas arredondadas × preço atual da impressão mais barata. Clique num deck para ver a evolução, os confrontos e a lista.")
    + (pk ? ` Δ compara com a ${pn}. Nas expansões antigas o Duels.ink nomeava menos arquétipos, então decks "Outros" não são comparados.` : "");
  const hr = tbl.createTHead().insertRow();
  cols.forEach(([k, t]) => { const th = el("th", ["rank", "name"].includes(k) ? "" : "num", t);
    if (k !== "rank") { th.tabIndex = 0; if (sk === k) th.setAttribute("aria-sort", dir < 0 ? "descending" : "ascending");
      th.onclick = () => { S.deckSort = { key: k, dir: S.deckSort.key === k ? -S.deckSort.dir : (k === "name" ? 1 : -1) }; renderDecks(); }; }
    hr.append(th); });
  const pp = (v) => v == null ? "–" : (v > 0 ? "+" : "") + (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " p.p.";
  const body = tbl.createTBody();
  rows.forEach((r, n) => {
    const tr = body.insertRow(); tr.tabIndex = 0;
    if (!byColors && S.selDeck === r.key) tr.style.background = "var(--accent-wash)";
    tr.onclick = tr.onkeydown = (e) => { if (e.type !== "click" && e.key !== "Enter") return;
      if (byColors) { S.filter.inks = new Set(r.colors); S.view.deckView = "deck"; changed(); }
      else { S.selDeck = r.key; renderDecks(); $("deck-evo").scrollIntoView({ behavior: "smooth", block: "start" }); } };
    tr.insertCell().textContent = n + 1;
    const nc = tr.insertCell(); nc.className = "name"; nc.append(inkDots(r.colors), document.createTextNode(r.name));
    if (!byColors && r.d.builds > 1) nc.append(el("small", null, `${r.d.builds} builds`));
    numCell(tr, r.games.toLocaleString("pt-BR")); numCell(tr, pct1(r.play));
    if (pk) { const td = numCell(tr, pp(r.dPlay)); if (r.dPlay) td.className += r.dPlay > 0 ? " up" : " down"; }
    const w = numCell(tr, pct1(r.wr)); w.className += wrClass(r.wr);
    if (pk) { const td = numCell(tr, pp(r.dWr)); if (r.dWr) td.className += r.dWr > 0 ? " up" : " down"; }
    if (!byColors) numCell(tr, usd0(r.cost));
  });
  renderDeckDetail();
}

function renderDeckDetail() {
  const box = $("deck-detail"), evo = $("deck-evo");
  if (S.view.deckView !== "deck" || S.selDeck == null) { box.hidden = true; evo.hidden = true; return; }
  const ek = S.view.deckEra || S.duels.decks.current, era = deckEraData(ek);
  // evolution across eras (one chart per measure)
  const order = eraOrder(), name = (S.dcur.decks.find((d) => d.key === S.selDeck) || era.decks.find((d) => d.key === S.selDeck) || { name: S.selDeck }).name;
  const pts = order.map((k) => { const e = deckEraData(k), d = e.decks.find((x) => x.key === S.selDeck), info = eraInfo(k);
    return { date: info.start, play: d ? Math.round(d.games / (2 * e.totalGames) * 1000) / 10 : null, wr: d ? Math.round(d.wins / d.games * 1000) / 10 : null, n: d ? Math.round(d.games / 2) : null }; });
  evo.hidden = false;
  $("de-title-play").textContent = `Presença: ${name}`; $("de-title-wr").textContent = `Win rate: ${name}`;
  const pctFmt = (v) => Number(v).toLocaleString("pt-BR") + "%";
  lineChart("c-deck-play", pts.map((p) => p.date), pts.map((p) => p.play), "Presença", { counts: pts.map((p) => p.n), yfmt: pctFmt, eraLabels: order.map((k) => eraInfo(k).name) });
  lineChart("c-deck-wr", pts.map((p) => p.date), pts.map((p) => p.wr), "Win rate", { counts: pts.map((p) => p.n), yfmt: pctFmt, eraLabels: order.map((k) => eraInfo(k).name) });
  const d = era.decks.find((x) => x.key === S.selDeck);
  if (!d) { box.hidden = true; return; }
  box.hidden = false;
  const idx = era.decks.indexOf(d);
  $("dd-title-mu").textContent = `Confrontos: ${d.name} (${eraInfo(ek).name})`;
  const mus = (era.matchups || []).filter((m) => m[0] === idx && m[2] >= 30).map((m) => ({ o: era.decks[m[1]], games: m[2], wr: m[3] / m[2], mirror: m[1] === idx }));
  $("dd-note-mu").textContent = mus.length
    ? `Win rate de ${d.name} contra cada deck (mínimo de 30 partidas). Win rate geral: ${pct1(d.wins / d.games)} em ${d.games.toLocaleString("pt-BR")} partidas.`
    : "O Duels.ink não tem confrontos por deck nesta expansão.";
  const { key, dir } = S.muSort;
  mus.sort((a, b) => { const x = key === "name" ? a.o.name : a[key], y = key === "name" ? b.o.name : b[key]; return (x > y ? 1 : x < y ? -1 : 0) * dir; });
  const t = $("t-mu"); t.replaceChildren();
  const hr = t.createTHead().insertRow();
  [["name", "Contra"], ["games", "Partidas"], ["wr", "Win rate"]].forEach(([k, l]) => { const th = el("th", k === "name" ? "" : "num", l); th.tabIndex = 0;
    if (key === k) th.setAttribute("aria-sort", dir < 0 ? "descending" : "ascending");
    th.onclick = () => { S.muSort = { key: k, dir: S.muSort.key === k ? -S.muSort.dir : (k === "name" ? 1 : -1) }; renderDeckDetail(); }; hr.append(th); });
  const b = t.createTBody();
  mus.forEach((m) => { const tr = b.insertRow(); tr.style.cursor = "default";
    const nc = tr.insertCell(); nc.className = "name"; nc.append(inkDots(m.o.colors), document.createTextNode(m.o.name + (m.mirror ? " (espelho)" : "")));
    numCell(tr, m.games.toLocaleString("pt-BR")); const w = numCell(tr, pct1(m.wr)); w.className += wrClass(m.wr); });
  $("dd-title-list").textContent = `Lista típica: ${d.name} (${eraInfo(ek).name})`;
  const items = Object.entries(d.list).map(([cid, cp]) => ({ cid, cp, n: Math.round(cp), c: cardForCid(cid) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n || ((b.c?.price || 0) - (a.c?.price || 0)));
  const tot = items.reduce((a, x) => a + (x.c ? x.n * x.c.price : 0), 0);
  $("dd-note-list").textContent = `Cópias médias da lista típica (arredondadas), com o preço atual da impressão mais barata. Total: ${usd0(tot)} para ${items.reduce((a, x) => a + x.n, 0)} cartas. Clique numa carta para ver o histórico.`;
  const lt = $("t-list"); lt.replaceChildren();
  const lh = lt.createTHead().insertRow(); ["", "Carta", "Cópias", "Preço", "Subtotal"].forEach((h, i) => lh.append(el("th", i > 1 ? "num" : "", h)));
  const lb = lt.createTBody();
  items.forEach((x) => { const tr = lb.insertRow();
    if (x.c) { tr.tabIndex = 0; tr.onclick = () => openDetail(x.c); imgCell(tr, x.c); nameCell(tr, x.c); }
    else { tr.insertCell(); tr.insertCell().textContent = x.cid; }
    numCell(tr, x.cp.toLocaleString("pt-BR", { maximumFractionDigits: 1 }));
    numCell(tr, usd(x.c?.price)); numCell(tr, x.c ? usd(x.n * x.c.price) : "–"); });
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
function barChart(id, labels, datasets, { horizontal = false, log = false, stacked = false, legend = false, tooltip, fmt, onClick }) {
  const o = baseOpts(), vAxis = horizontal ? "x" : "y", cAxis = horizontal ? "y" : "x";
  o.indexAxis = horizontal ? "y" : "x";
  o.scales[cAxis].grid.display = false;
  o.scales[cAxis].stacked = stacked; o.scales[vAxis].stacked = stacked;
  if (horizontal) o.scales[cAxis].ticks = { autoSkip: false, callback: (v) => { const l = labels[v] || ""; return l.length > 24 ? l.slice(0, 22) + "…" : l; } };
  o.scales[vAxis].type = log ? "logarithmic" : "linear";
  o.scales[vAxis].ticks = { callback: (v) => (log && ![0.1, 1, 10, 100, 1000, 10000, 100000].includes(v)) ? "" : fmt ? fmt(v) : "$" + Number(v).toLocaleString("pt-BR") };
  if (log) o.scales[vAxis].title = { display: true, text: "escala logarítmica" };
  o.plugins.tooltip.callbacks = { title: (it) => labels[it[0].dataIndex], label: (ctx) => tooltip(ctx.dataIndex, ctx.datasetIndex) };
  if (onClick) {
    o.onClick = (_e, els) => { if (els.length) { const { index, datasetIndex } = els[0]; setTimeout(() => onClick(index, datasetIndex), 0); } }; // defer: the click re-renders (destroys) this chart
    o.onHover = (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; };
  }
  if (legend) { o.plugins.legend = { display: true, position: "top", align: "start", labels: { boxWidth: 12, boxHeight: 12, color: css("--text-secondary") } }; o.plugins.tooltip.displayColors = true; }
  const ds = datasets.map((d) => ({
    backgroundColor: css("--series-1"), hoverBackgroundColor: d.backgroundColor ? undefined : css("--series-1-hover"),
    borderRadius: stacked ? 0 : 4, borderSkipped: "start", borderColor: css("--surface-1"), borderWidth: stacked ? { right: 2 } : 0,
    maxBarThickness: 28, categoryPercentage: 0.85, ...d,
  }));
  upsert(id, { type: "bar", data: { labels, datasets: ds }, options: o });
}
function lineChart(id, labels, values, name, { counts, yfmt, eraLabels } = {}) {
  const o = baseOpts();
  const ts = (d) => Date.parse((d.length === 7 ? d + "-15" : d) + "T12:00:00Z");
  const data = labels.map((d, i) => ({ x: ts(d), y: values[i] ?? null, d, n: counts ? counts[i] : null }));
  const mo = (t) => { const d = new Date(t); return String(d.getUTCMonth() + 1).padStart(2, "0") + "/" + String(d.getUTCFullYear()).slice(2); };
  const xmin = data.length ? data[0].x : undefined, xmax = data.length ? data[data.length - 1].x : undefined;
  o.layout = { padding: { top: 18 } };
  o.interaction = { mode: "nearest", axis: "x", intersect: false };
  o.scales.x = { type: "linear", min: xmin, max: xmax, grid: { display: false }, border: { display: false },
    ticks: { maxTicksLimit: 8, maxRotation: 0, callback: (v) => mo(v) } };
  o.scales.y.ticks = { callback: (v) => yfmt ? yfmt(v) : "$" + Number(v).toLocaleString("pt-BR") };
  o.plugins.tooltip.callbacks = {
    title: (it) => { if (eraLabels) return eraLabels[it[0].dataIndex] + " (desde " + fmtDate(it[0].raw.d) + ")"; const d = it[0].raw.d; return d.length === 7 ? "fim de " + d.slice(5) + "/" + d.slice(0, 4) : fmtDate(d); },
    label: (ctx) => yfmt ? yfmt(ctx.parsed.y) : usd(ctx.parsed.y),
    afterLabel: (ctx) => ctx.raw.n ? `${ctx.raw.n.toLocaleString("pt-BR")} ${eraLabels ? "partidas" : "cartas"}` : "",
  };
  o.plugins.evlines = { items: eventItems() };
  if (eraLabels) { const pad = 20 * 864e5; o.scales.x.min = xmin - pad; o.scales.x.max = xmax + pad; o.scales.y.grace = "15%"; }
  const ds = { label: name, data, parsing: false, borderColor: css("--series-1"), borderWidth: 2, pointRadius: data.length < 40 ? (eraLabels ? 5 : 3) : 0, pointHoverRadius: 5,
    pointBackgroundColor: css("--series-1"), pointBorderColor: css("--surface-1"), pointBorderWidth: 2, spanGaps: true, tension: 0 };
  upsert(id, { type: "line", data: { datasets: [ds] }, options: o, plugins: [crosshair, evlines] });
}
function eventItems() {
  const items = [];
  if (S.view.ev.rel) S.events.releases.forEach((r) => items.push({ x: Date.parse(r.date + "T12:00:00Z"), label: r.code, kind: "rel" }));
  if (S.view.ev.rot) S.events.rotations.forEach((r) => items.push({ x: Date.parse(r.date + "T12:00:00Z"), label: "Rot.", kind: "rot" }));
  return items.sort((a, b) => a.x - b.x || (a.kind === "rot") - (b.kind === "rot"));
}
const evlines = { id: "evlines", afterDatasetsDraw(chart, _a, opts) {
  const items = (opts && opts.items) || [], xs = chart.scales.x, { top, bottom, left, right } = chart.chartArea, ctx = chart.ctx;
  ctx.save(); ctx.font = "10px " + Chart.defaults.font.family; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  let lastPx = -1e9, row = 0;
  items.forEach((it) => {
    const px = xs.getPixelForValue(it.x); if (px < left - 1 || px > right + 1) return;
    const rot = it.kind === "rot";
    ctx.strokeStyle = rot ? css("--critical") : css("--text-muted"); ctx.lineWidth = rot ? 1.5 : 1; ctx.setLineDash(rot ? [] : [4, 3]);
    ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, bottom); ctx.stroke();
    // stagger labels that would collide with the previous one (row 0 sits above the plot)
    row = px - lastPx < 26 ? row + 1 : 0; lastPx = px;
    ctx.fillStyle = rot ? css("--critical") : css("--text-secondary");
    ctx.fillText(it.label, Math.min(Math.max(px, left + 10), right - 10), top - 3 + row * 12);
  });
  ctx.restore();
} };
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

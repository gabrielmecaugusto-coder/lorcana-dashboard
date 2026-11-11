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
  filter: { window: "d30", from: "", to: "", format: "", sets: new Set(), inks: new Set(), rarities: new Set(), mechs: new Set(), decks: new Set(), cats: new Set(), fx: new Set(), printing: "", min: 0, q: "" },
  duels: null, duelsByPid: new Map(), duelsById: new Map(), metaSort: { key: "dUse", dir: -1 }, metaPage: 0,
  deckSort: { key: "wr", dir: -1 }, mechSort: { key: "dShare", dir: -1 }, mechOpen: null, mechLines: {}, momSel: new Set(), mcSort: { key: "s1", dir: -1 }, mcPage: 0, muSort: { key: "games", dir: -1 }, selDeck: null, /* deck key */ deckMin: 2000,
  view: { evoMetric: "total", group: "set", distMetric: "total", chgGroup: "ink", deckView: "deck", deckEra: "", catGran: "era", mechGran: "week", mechLevel: "func", compLevel: "func", dlLevel: "func", insCat: "Aggro", insLevel: "sub", cardsAll: false, whyLevel: "sub", vsCat: "Aggro", gran: "monthly", ev: { rel: true, rot: true } },
  sort: { key: "share", dir: -1 }, page: 0, tab: "overview", charts: {}, detail: null, ms: {},
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
  // Card functions (public): powers the decklist analyser.
  try { S.fn = await getJSON("data/functions.json"); $("tab-btn-deck").hidden = false; $("tab-btn-concepts").hidden = false; } catch (e) { S.fn = null; }
  try { if (S.fn) { S.ins = await getJSON("data/insights.json"); $("tab-btn-ins").hidden = false; $("ins-foot").hidden = false; } } catch (e) { S.ins = null; }
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
  const boxes = options.map(([value, label, tip]) => {
    const lab = el("label"), cb = el("input"); cb.type = "checkbox"; cb.value = value; if (tip) lab.title = tip;
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
  if (S.duels && S.duels.taxonomy) S.ms.mom = multiSelect($("f-mom"), S.duels.taxonomy.moments.map((m, i) => [String(i), m, (S.duels.taxonomy.desc || {}).moments?.[i]]), S.momSel, "Todos", () => { S.mechOpen = null; renderMechs(); });
  if (S.duels && !S.duels.taxonomy) { S.view.mechLevel = "duels"; document.querySelectorAll('[data-ctl="mechLevel"] button:not([data-v="duels"])').forEach((b) => b.hidden = true); }
  if (S.duels && S.duels.decks && S.duels.decks.categories) $("vscat-seg").replaceChildren(...S.duels.decks.categories.order.map((c) => { const b = el("button", null, "vs " + c); b.type = "button"; b.dataset.v = c; b.title = CAT_DESC[c]; return b; }));
  else $("vscat-box").hidden = true;
  if (S.duels && S.duels.decks && S.duels.decks.categories) S.ms.cats = multiSelect($("f-cat"), S.duels.decks.categories.order.map((c) => [c, c, CAT_DESC[c]]), f.cats, "Todas", changed);
  else {
    ["cat-box", "catevo-box", "comp-box"].forEach((id) => $(id).hidden = true);
    if (S.ins) S.ms.cats = multiSelect($("f-cat"), S.ins.categories.order.map((c) => [c, c, CAT_DESC[c]]), f.cats, "Todas", changed);
  }
  if (!S.dcur && S.ins) S.ms.decks = multiSelect($("f-deck"), S.ins.decks.map((d) => [d.key, `${d.name} (${d.category})`]), f.decks, "Todos", changed);
  if (S.fn) {
    const T = S.fn, opts = [];
    T.funcs.forEach((fn, fi) => {
      opts.push(["f:" + fi, fn, T.desc.funcs[fi]]);
      T.subs.forEach(([sf, sn], si) => { if (sf !== fi) return;
        if (sn !== fn) opts.push(["s:" + si, `${fn} › ${sn}`, T.desc.subs[si]]);
        T.habs.forEach(([hs, hn], hi) => { if (hs === si && hn !== sn) opts.push(["h:" + hi, `${fn} › ${sn} › ${hn}`, T.desc.habs[hi]]); }); });
    });
    S.ms.fx = multiSelect($("f-fx"), opts, f.fx, "Todas", changed);
  }
  $("cards-all").onchange = (e) => { S.view.cardsAll = e.target.checked; S.page = 0; renderCards(); };
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
    Object.assign(f, { format: "", printing: "", min: 0, q: "" }); f.sets.clear(); f.inks.clear(); f.rarities.clear(); f.mechs.clear(); f.decks.clear(); f.cats.clear(); f.fx.clear();
    changed();
  };
  document.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => { S.tab = b.dataset.tab; changed(); });
  $("dl-go").onclick = () => { S.dlText = $("dl-text").value; try { localStorage.setItem("lorcana-decklist", S.dlText); } catch (e) { /* storage off */ } renderDeckAnalysis(); };
  $("dl-clear").onclick = () => { $("dl-text").value = ""; S.dlText = ""; try { localStorage.removeItem("lorcana-decklist"); } catch (e) { /* storage off */ } renderDeckAnalysis(); };
  try { S.dlText = localStorage.getItem("lorcana-decklist") || ""; } catch (e) { S.dlText = ""; }
  $("dl-text").value = S.dlText;
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
  S.ms.sets.sync(); S.ms.rarities.sync(); if (S.ms.mechs) S.ms.mechs.sync(); if (S.ms.decks) S.ms.decks.sync(); if (S.ms.cats) S.ms.cats.sync(); if (S.ms.fx) S.ms.fx.sync();
  document.querySelectorAll(".ink").forEach((b) => b.setAttribute("aria-pressed", f.inks.has(b.dataset.ink)));
  document.querySelector(".custom-range").hidden = f.window !== "custom" || S.tab === "cards";
  filterVis();
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === S.tab));
  document.querySelectorAll(".tab").forEach((t) => t.hidden = t.id !== "tab-" + S.tab);
  syncView();
}
/** Which filters make sense on the current tab (the bar is shared by all tabs). */
function filterVis() {
  const t = S.tab;
  document.querySelectorAll(".filters [data-notab]").forEach((e) => e.hidden = e.dataset.notab.split(",").includes(t));
  document.querySelectorAll(".filters [data-only]").forEach((e) => e.hidden = !e.dataset.only.split(",").includes(t));
  // deck / category: always in the private build; in the public one only on Cards (they set the base of the meta share)
  ["deck-filter-wrap", "cat-filter-wrap"].forEach((id) => { const e = $(id), ok = id === "deck-filter-wrap" ? !!S.ms.decks : !!S.ms.cats;
    e.hidden = !ok || (!S.duels && t !== "cards"); });
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
  if (f.cats.size) p.set("cat", [...f.cats].join(","));
  if (f.fx.size) p.set("fx", [...f.fx].join(","));
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
  f.decks.clear(); if (S.dcur || S.ins) list("deck").forEach((x) => f.decks.add(x));
  f.cats.clear(); if (S.dcur || S.ins) list("cat").forEach((x) => f.cats.add(x));
  f.fx.clear(); if (S.fn) list("fx").forEach((x) => f.fx.add(x));
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

function passes(c, ignoreMech = false) {
  const f = S.filter;
  if (f.format === "core" && !c.core) return false;
  if (f.format === "core-strict" && !(c.core && /^\d+$/.test(c.setCode || "") && +c.setCode >= (S.events.coreMinSet || 9))) return false;
  if (f.format === "infinity" && !c.inf) return false;
  if (f.sets.size && !f.sets.has(String(c.set))) return false;
  if (f.inks.size && !inkList(c).some((i) => f.inks.has(i))) return false;
  if (f.rarities.size && !f.rarities.has(c.rarity)) return false;
  if (f.mechs.size && !ignoreMech) { const d = duelsOf(c); if (!d || !d.m.some((i) => f.mechs.has(String(i)))) return false; }
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
  S.rows = S.cards.filter((c) => passes(c));
  if (S.tab === "overview") renderOverview(S.rows);
  if (S.tab === "movers") renderMovers(S.rows);
  if (S.tab === "cards") renderCards();
  if (S.tab === "meta") { S.metaPage = 0; renderMeta(); }
  if (S.tab === "decks") renderDecks();
  if (S.tab === "mechs") renderMechs();
  if (S.tab === "deck") renderDeckAnalysis();
  if (S.tab === "insights") renderInsights();
  if (S.tab === "concepts") renderConcepts();
  document.querySelector(".filters").hidden = ["deck", "insights", "concepts"].includes(S.tab);
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

/* ---------- Cards tab: share of the meta ---------- */
/** card ident -> does it have one of the selected funções / subfunções / habilidades? */
function fxMatch(ident) {
  const sel = S.filter.fx; if (!sel.size) return true;
  const T = S.fn, fx = (T && T.byIdent[ident]) || [];
  return fx.some(([hi]) => { const si = T.habs[hi][0]; return sel.has("h:" + hi) || sel.has("s:" + si) || sel.has("f:" + T.subs[si][0]); });
}
let duelsIdentCache = null;
function identOfDuels(id) {
  if (!duelsIdentCache) { duelsIdentCache = new Map(); S.cards.forEach((c) => { const d = duelsOf(c); if (d && !duelsIdentCache.has(d.id)) duelsIdentCache.set(d.id, c.ident); }); }
  return duelsIdentCache.get(id);
}
/** Decks that form the base of the share, per the deck / category / colour filters. */
function usageBase() {
  const f = S.filter;
  if (S.dcur) { // private: Duels.ink online ladder, weighted by games
    const decks = S.dcur.decks.filter(deckPred()).map((d) => { const l = new Map(); Object.entries(d.list).forEach(([id, n]) => { const k = identOfDuels(id); if (k) l.set(k, (l.get(k) || 0) + n); }); return { w: d.games, list: l }; });
    return { decks, src: "duels", scope: deckScopeText() };
  }
  if (!S.ins) return null;
  const inkOk = f.inks.size === 1 ? (d) => d.colors.includes([...f.inks][0]) : f.inks.size > 1 ? (d) => d.colors.every((c) => f.inks.has(c)) : () => true;
  const sel = S.ins.decks.filter((d) => (!f.decks.size || f.decks.has(d.key)) && (f.decks.size || ((!f.cats.size || f.cats.has(d.category)) && inkOk(d))));
  const scope = f.decks.size ? (sel.length === 1 ? sel[0].name : `${sel.length} decks escolhidos`)
    : [f.inks.size ? `com ${[...f.inks].join("/")}` : "", f.cats.size ? [...f.cats].join("/") : ""].filter(Boolean).join(", ") || "todos";
  return { decks: sel.map((d) => ({ w: 1, list: new Map(Object.entries(d.list)), name: d.name })), src: "ref", scope };
}
function usageMap(base) {
  const W = base.decks.reduce((a, d) => a + d.w, 0), out = new Map();
  base.decks.forEach((d) => d.list.forEach((n, k) => { if (n < 0.5) return; const o = out.get(k) || { w: 0, cp: 0, n: 0 }; o.w += d.w; o.cp += n * d.w; o.n++; out.set(k, o); }));
  out.forEach((o) => { o.share = W ? o.w / W : 0; o.copies = o.cp / o.w; });
  return out;
}
const fnNames = (ident) => { const T = S.fn, fx = (T && T.byIdent[ident]) || []; return [...new Set(fx.map(([hi]) => T.funcs[T.subs[T.habs[hi][0]][0]]))]; };
const habNames = (ident) => { const T = S.fn, fx = (T && T.byIdent[ident]) || []; return [...new Set(fx.map(([hi]) => { const si = T.habs[hi][0]; return `${T.funcs[T.subs[si][0]]} › ${T.subs[si][1]} › ${T.habs[hi][1]}`; }))]; };
function renderCards() {
  const base = usageBase(), tbl = $("t-cards");
  $("cards-all").checked = S.view.cardsAll;
  if (!base) { $("cards-note").textContent = "Os dados de uso no meta não estão disponíveis."; tbl.replaceChildren(); return; }
  const U = usageMap(base), ref = refCards(), idents = new Set();
  S.rows.forEach((c) => { if (c.ident && fxMatch(c.ident)) idents.add(c.ident); });
  let rows = [...idents].map((k) => { const u = U.get(k); return { c: ref.get(k), k, share: u ? u.share : 0, copies: u ? u.copies : null, n: u ? u.n : 0 }; }).filter((r) => r.c);
  if (!S.view.cardsAll) rows = rows.filter((r) => r.share > 0);
  const cols = [["img", "", null], ["name", "Carta", (r) => r.c.name], ["cost", "Custo", (r) => +r.c.cost || 0], ["fn", "Funções", null],
    ["share", "Presença nos decks", (r) => r.share], ["copies", "Cópias (quando usa)", (r) => r.copies ?? -1]];
  if (base.src === "ref") cols.push(["n", "Decks", (r) => r.n]);
  const col = cols.find((c) => c[0] === S.sort.key && c[2]) || cols[4]; if (col[0] !== S.sort.key) S.sort = { key: "share", dir: -1 };
  rows.sort((a, b) => { const x = col[2](a), y = col[2](b); return ((x > y ? 1 : x < y ? -1 : 0) * S.sort.dir) || (b.share - a.share) || a.c.name.localeCompare(b.c.name); });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); S.page = Math.min(S.page, pages - 1);
  $("pg-info").textContent = `${S.page + 1} / ${pages}`;
  const nd = base.decks.length;
  $("cards-count").textContent = `· ${rows.length.toLocaleString("pt-BR")} cartas`;
  $("cards-note").textContent = base.src === "ref"
    ? `Base: ${nd} ${nd === 1 ? "lista de referência" : "listas de referência"} (${base.scope}), escolhidas por nós entre as builds mais jogadas de cada arquétipo do ranqueado online (${S.ins.eraName}). Presença = fração dessas listas que usa a carta; cópias = média de cópias nas listas que usam. Mude cor, categoria ou deck nos filtros para mudar a base.`
    : `Base: ${nd} decks do ranqueado Core BO1 do Duels.ink (${base.scope}), ponderados por partidas. Presença = fatia das partidas desses decks cuja lista média tem a carta (0,5 cópia ou mais); cópias = média nas listas que usam. Mude cor, categoria ou deck nos filtros para mudar a base.`;
  tbl.replaceChildren();
  const head = tbl.createTHead().insertRow();
  cols.forEach(([k, t, f]) => {
    const th = el("th", ["cost", "share", "copies", "n"].includes(k) ? "num" : "", t);
    if (f) {
      th.tabIndex = 0; if (S.sort.key === k) th.setAttribute("aria-sort", S.sort.dir < 0 ? "descending" : "ascending");
      th.onclick = th.onkeydown = (e) => { if (e.type === "click" || e.key === "Enter") { S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : (k === "name" || k === "cost" ? 1 : -1) }; renderCards(); } };
    }
    head.append(th);
  });
  const body = tbl.createTBody();
  rows.slice(S.page * PAGE, S.page * PAGE + PAGE).forEach((r) => {
    const tr = body.insertRow(); tr.tabIndex = 0;
    tr.onclick = tr.onkeydown = (e) => { if (e.type === "click" || e.key === "Enter") openDetail(r.c); };
    imgCell(tr, r.c);
    const td = tr.insertCell(); td.className = "name"; td.append(document.createTextNode(r.c.name), el("small", null, [r.c.ink && r.c.ink.replace(";", "/"), r.c.type].filter(Boolean).join(" · ")));
    numCell(tr, r.c.cost || "–");
    const fc = tr.insertCell(); fc.className = "small tip"; fc.textContent = fnNames(r.k).join(", ") || "–"; fc.title = habNames(r.k).join("\n");
    const sc = numCell(tr, r.share ? pct1(r.share) : "–"); if (r.share) { const bar = el("i", "sharebar"); bar.style.width = Math.round(r.share * 60) + "px"; sc.prepend(bar); }
    numCell(tr, r.copies == null ? "–" : num2(r.copies));
    if (base.src === "ref") numCell(tr, r.n ? `${r.n} de ${nd}` : "–");
  });
}
/** From an analysis to the Cards tab, filtered by one função / subfunção / habilidade. */
function goCards(level, k) {
  const f = S.filter; f.fx.clear(); f.fx.add(`${level[0]}:${k}`);
  f.inks.clear(); f.decks.clear(); f.cats.clear(); f.q = ""; S.sort = { key: "share", dir: -1 };
  S.tab = "cards"; changed(); window.scrollTo({ top: 0, behavior: "smooth" });
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
function deckPred(eraKey) {
  const f = S.filter;
  if (f.decks.size) return (d) => f.decks.has(d.key);
  const ek = eraKey || (S.duels && S.duels.decks.current);
  const catOk = f.cats.size ? (d) => { const r = catOf(d.key, ek); return !!r && f.cats.has(r.cat); } : () => true;
  if (f.inks.size === 1) { const ink = [...f.inks][0]; return (d) => d.colors.includes(ink) && catOk(d); }
  if (f.inks.size > 1) return (d) => d.colors.every((c) => f.inks.has(c)) && catOk(d);
  return catOk;
}
function deckScopeText() {
  const f = S.filter;
  if (f.decks.size) return f.decks.size === 1 ? S.dcur.decks.find((d) => f.decks.has(d.key))?.name || "deck selecionado" : `${f.decks.size} decks selecionados`;
  const cat = f.cats.size ? ` (${[...f.cats].join("/")})` : "";
  if (f.inks.size === 1) return `decks com ${[...f.inks][0]}${cat}`;
  if (f.inks.size > 1) return `decks ${[...f.inks].join("/")}${cat}`;
  return f.cats.size ? `decks ${[...f.cats].join("/")}` : "todos os decks";
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
  const total = era.totalGames, pred = deckPred(ek), byColors = S.view.deckView === "colors";
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
        return { key: d.key, d, name: d.name, colors: d.colors, games: d.games, play, wr, cost: deckCost(d).t, cat: catOf(d.key, ek),
          dPlay: q && named ? play - q.games / (2 * prev.totalGames) : null, dWr: q && named ? wr - q.wins / q.games : null }; })
      .filter((r) => r.games >= S.deckMin && (f.decks.size ? true : pred(r.d)));
  }
  const pn = pk ? eraInfo(pk).name : null;
  const cols = [["rank", "#"], ["name", byColors ? "Cores" : "Deck"]].concat(byColors || !S.duels.decks.categories ? [] : [["catName", "Categoria"]]).concat([["games", "Partidas"], ["play", "Presença"]])
    .concat(pk ? [["dPlay", `Δ presença vs ${pn}`]] : []).concat([["wr", "Win rate"]]).concat(pk ? [["dWr", `Δ win rate vs ${pn}`]] : [])
    .concat(byColors ? [] : [["cost", "Custo da lista"]]);
  const { key, dir } = S.deckSort;
  const sk = cols.some((c) => c[0] === key) && key !== "rank" ? key : "wr";
  rows.forEach((r) => { r.catName = r.cat ? r.cat.cat : null; });
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
    if (cols.some((c) => c[0] === "catName")) catCell(tr, r.cat);
    numCell(tr, r.games.toLocaleString("pt-BR")); numCell(tr, pct1(r.play));
    if (pk) { const td = numCell(tr, pp(r.dPlay)); if (r.dPlay) td.className += r.dPlay > 0 ? " up" : " down"; }
    const w = numCell(tr, pct1(r.wr)); w.className += wrClass(r.wr);
    if (pk) { const td = numCell(tr, pp(r.dWr)); if (r.dWr) td.className += r.dWr > 0 ? " up" : " down"; }
    if (!byColors) numCell(tr, usd0(r.cost));
  });
  renderDeckDetail();
  renderCategories(ek);
  renderComposition(ek, byColors ? null : rows.map((r) => r.d));
  renderMatchupDrivers(ek);
  renderVsCategory(ek);
}

/* ---------- deck composition by função / subfunção / habilidade ---------- */
const COMP_COLORS = { light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#7d5fd3", "#0e8f8f", "#9a9a92"], dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#8f75e0", "#1aa3a3", "#7d7d76"] };
/** items: [{fx, w, name}] (w = weight, e.g. copies); a card with several functions counts fully in each. */
function compParts(T, items, level, size) {
  const keyOf = { func: (hi) => T.subs[T.habs[hi][0]][0], sub: (hi) => T.habs[hi][0], hab: (hi) => hi }[level];
  const labelOf = { func: (k) => T.funcs[k], sub: (k) => T.subs[k][1], hab: (k) => T.habs[k][1] }[level];
  const descOf = (k) => (T.desc ? { func: T.desc.funcs, sub: T.desc.subs, hab: T.desc.habs }[level][k] : "") || "";
  const parentOf = { func: () => "", sub: (k) => T.funcs[T.subs[k][0]], hab: (k) => `${T.funcs[T.subs[T.habs[k][0]][0]]} › ${T.subs[T.habs[k][0]][1]}` }[level];
  const acc = new Map(), cardsIn = new Map(); let total = 0;
  items.forEach(({ fx, w, name }) => {
    const ks = [...new Set((fx || []).map(([hi]) => keyOf(hi)))], keys = ks.length ? ks : ["?"]; total += w;
    keys.forEach((k) => { acc.set(k, (acc.get(k) || 0) + w); const m = cardsIn.get(k) || new Map(); m.set(name, (m.get(name) || 0) + w); cardsIn.set(k, m); });
  });
  if (!total) return null;
  const roles = [...acc.values()].reduce((a, v) => a + v, 0);
  let parts = [...acc].map(([k, v]) => ({ k, slice: v / roles, label: k === "?" ? "Sem dados" : labelOf(k), parent: k === "?" ? "" : parentOf(k), desc: k === "?" ? "Cartas sem dados de habilidade." : descOf(k),
    cards: v / total * size, share: v / total, top: [...cardsIn.get(k)].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n) })).sort((a, b) => b.share - a.share);
  const MAX = 8;
  if (parts.length > MAX + 1) { const rest = parts.slice(MAX); parts = parts.slice(0, MAX).concat([{ k: "rest", label: `Demais (${rest.length})`, parent: "", desc: rest.map((p) => p.label).join(", "), slice: rest.reduce((a, p) => a + p.slice, 0), cards: null, share: null, top: rest.slice(0, 3).map((p) => p.label) }]); }
  return parts;
}
const wrapText = (t, n = 55) => { const out = []; let line = ""; (t || "").split(" ").forEach((w) => { if ((line + " " + w).length > n) { out.push(line); line = w; } else line = line ? line + " " + w : w; }); if (line) out.push(line); return out; };
function drawComposition(parts, level, canvasId, tableId, size) {
  const col = COMP_COLORS[matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"];
  const sz = Math.round(size), f1 = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const o = baseOpts(); delete o.scales;
  o.plugins.legend = { display: true, position: "bottom", labels: { boxWidth: 12, boxHeight: 12, color: css("--text-secondary") } };
  o.plugins.tooltip.displayColors = true; o.plugins.tooltip.bodyFont = { weight: "400" };
  o.plugins.tooltip.callbacks = { label: (ctx) => { const p = parts[ctx.dataIndex]; return `${p.label}: ${pct1(p.slice)} das funções` + (p.cards != null ? ` · ${f1(p.cards)} de ${sz} cartas` : ""); },
    afterLabel: (ctx) => wrapText(parts[ctx.dataIndex].desc) };
  upsert(canvasId, { type: "pie", data: { labels: parts.map((p) => p.label), datasets: [{ data: parts.map((p) => Math.round(p.slice * 1000) / 10), backgroundColor: parts.map((_, i) => col[i % col.length]), borderColor: css("--surface-1"), borderWidth: 2 }] }, options: o });
  const t = $(tableId); t.replaceChildren();
  const hr = t.createTHead().insertRow(); [["", ""], [{ func: "Função", sub: "Subfunção", hab: "Habilidade" }[level], ""], [`Cartas (de ${sz})`, "num"], ["% do deck", "num"], ["Fatia", "num"], ["Principais cartas", ""]].forEach(([h, c]) => hr.append(el("th", c, h)));
  const b = t.createTBody();
  parts.forEach((p, i) => { const tr = b.insertRow(); tr.style.cursor = "default";
    const sw = tr.insertCell(), dot = el("i"); dot.style.cssText = `display:inline-block;width:10px;height:10px;border-radius:2px;background:${col[i % col.length]}`; sw.append(dot);
    const nc = tr.insertCell(); nc.className = "name"; const lb = el("span", p.desc ? "tip" : null, p.label); if (p.desc) lb.title = p.desc; nc.append(lb); if (p.parent) nc.append(el("small", null, p.parent));
    numCell(tr, p.cards == null ? "–" : f1(p.cards)); numCell(tr, p.share == null ? "–" : pct1(p.share)); numCell(tr, pct1(p.slice));
    const tc = tr.insertCell(); tc.className = "small"; tc.style.whiteSpace = "normal"; tc.style.minWidth = "150px"; tc.textContent = p.top.join(" · "); });
}
const COMP_NOTE = " Uma carta com mais de uma função conta inteira em cada uma: \"Cartas\" é quantas cartas do deck fazem aquilo (a coluna soma mais que o total). A pizza mostra o peso de cada função no total de funções do deck. Habilidades de todos os momentos.";
function renderComposition(ek, decks) {
  const T = S.duels.taxonomy, box = $("comp-box");
  if (!T || !decks) { box.hidden = true; return; }
  box.hidden = false; syncView();
  const era = deckEraData(ek), sel = S.selDeck && era.decks.find((d) => d.key === S.selDeck);
  const use = sel ? [sel] : decks.filter((d) => d.list && Object.keys(d.list).length);
  const items = [];
  use.forEach((d) => Object.entries(d.list).forEach(([cid, cp]) => { const dc = S.duelsById.get(cid); items.push({ fx: dc && dc.fx, w: cp * d.games, name: (cardForCid(cid) || {}).name || cid }); }));
  const parts = compParts(T, items, S.view.compLevel, 60);
  if (!parts) { box.hidden = true; return; }
  const name = sel ? sel.name : (use.length === 1 ? use[0].name : `média de ${use.length} decks do ranking`);
  $("comp-title").textContent = `Composição: ${name} (${eraInfo(ek).name})`;
  $("comp-note").textContent = (sel ? "Lista típica do deck selecionado no ranking (clique em outro deck para trocar)." : "Deck médio dos decks que estão no ranking acima (pesado por partidas); clique num deck para ver só ele.") + COMP_NOTE;
  drawComposition(parts, S.view.compLevel, "c-comp", "t-comp", 60);
}

/* ---------- what drives good and bad matchups ---------- */
function levelFns(T, level) {
  return {
    keyOf: { func: (hi) => T.subs[T.habs[hi][0]][0], sub: (hi) => T.habs[hi][0], hab: (hi) => hi }[level],
    labelOf: { func: (k) => T.funcs[k], sub: (k) => `${T.funcs[T.subs[k][0]]} › ${T.subs[k][1]}`, hab: (k) => T.habs[k][1] }[level],
    descOf: (k) => (T.desc ? { func: T.desc.funcs, sub: T.desc.subs, hab: T.desc.habs }[level][k] : "") || "",
    skip: { func: (k) => k >= 7, sub: (k) => T.subs[k][0] >= 7, hab: (k) => T.subs[T.habs[k][0]][0] >= 7 }[level],
  };
}
/** cards per 60 that have each function/subfunção/habilidade (a card counts fully in each) */
function deckComp(d, T, keyOf) {
  const acc = new Map(), tot = Object.values(d.list).reduce((a, v) => a + v, 0) || 1;
  Object.entries(d.list).forEach(([cid, cp]) => { const dc = S.duelsById.get(cid); new Set((dc && dc.fx || []).map(([hi]) => keyOf(hi))).forEach((k) => acc.set(k, (acc.get(k) || 0) + cp * 60 / tot)); });
  return acc;
}
function wcorrJs(xs, ys, ws) {
  const W = ws.reduce((a, b) => a + b, 0), mx = xs.reduce((a, x, i) => a + ws[i] * x, 0) / W, my = ys.reduce((a, y, i) => a + ws[i] * y, 0) / W;
  let c = 0, vx = 0, vy = 0; xs.forEach((x, i) => { c += ws[i] * (x - mx) * (ys[i] - my); vx += ws[i] * (x - mx) ** 2; vy += ws[i] * (ys[i] - my) ** 2; });
  return vx && vy ? c / Math.sqrt(vx * vy) : 0;
}
/** rows: [{comp: Map, wr, g, name}] -> features ranked by (bottom third − top third) cards/60, with weighted correlation */
function driverStats(rows, keys) {
  const sorted = [...rows].sort((a, b) => a.wr - b.wr), n = Math.max(1, Math.round(sorted.length / 3));
  const bad = sorted.slice(0, n), good = sorted.slice(-n);
  const avg = (set, k) => set.reduce((a, r) => a + (r.comp.get(k) || 0) * r.g, 0) / set.reduce((a, r) => a + r.g, 0);
  return { bad, good, feats: keys.map((k) => ({ k, bad: avg(bad, k), good: avg(good, k), corr: wcorrJs(rows.map((r) => r.comp.get(k) || 0), rows.map((r) => r.wr), rows.map((r) => r.g)) }))
    .map((f) => ({ ...f, diff: f.bad - f.good })) };
}
function divergingChart(id, wrapId, feats, valueOf, posColor, negColor, tooltip, onClick) {
  const pos = feats.filter((f) => valueOf(f) > 0).sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 8), neg = feats.filter((f) => valueOf(f) < 0).sort((a, b) => valueOf(b) - valueOf(a)).slice(-6);
  const fts = pos.concat(neg);
  $(wrapId).style.height = Math.max(240, fts.length * 26 + 60) + "px";
  barChart(id, fts.map((f) => f.label), [{ data: fts.map((f) => Math.round(valueOf(f) * 10) / 10), backgroundColor: fts.map((f) => valueOf(f) >= 0 ? posColor : negColor), borderSkipped: false }],
    { horizontal: true, labelMax: 40, fmt: (v) => (v > 0 ? "+" : "") + Number(v).toLocaleString("pt-BR"), tooltip: (i) => tooltip(fts[i]), onClick: onClick ? (i) => onClick(fts[i]) : undefined });
}
const MU_MIN = 300; // games for a matchup to count
const GENERIC_ARCH = /^(Midrange|Aggro|Control|Outros|Tempo)$/;
const shortDeck = (d) => { const a = d.name.split(" · ")[1] || d.name; return GENERIC_ARCH.test(a) ? d.name : a; };
function renderMatchupDrivers(ek) {
  const box = $("why-box"), T = S.duels.taxonomy, era = deckEraData(ek);
  const d = S.view.deckView === "deck" && S.selDeck && era.decks.find((x) => x.key === S.selDeck);
  if (!T || !d || !(era.matchups || []).length) { box.hidden = true; return; }
  box.hidden = false; syncView();
  const idx = era.decks.indexOf(d), level = S.view.whyLevel, L = levelFns(T, level);
  const ops = era.matchups.filter((m) => m[0] === idx && m[1] !== idx && m[2] >= MU_MIN && Object.keys(era.decks[m[1]].list || {}).length)
    .map((m) => ({ o: era.decks[m[1]], g: m[2], wr: m[3] / m[2], comp: deckComp(era.decks[m[1]], T, L.keyOf) }));
  const f1 = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  $("why-title").textContent = `O que os oponentes difíceis têm: ${d.name}`;
  if (ops.length < 6) { $("why-note").textContent = "Poucos confrontos com dados suficientes nesta expansão."; upsert("c-why", { type: "bar", data: { labels: [], datasets: [] } }); }
  else {
    const keys = [...new Set(ops.flatMap((r) => [...r.comp.keys()]))].filter((k) => !L.skip(k));
    const st = driverStats(ops, keys);
    const feats = st.feats.filter((f) => Math.abs(f.diff) >= 0.5).sort((a, b) => b.diff - a.diff).map((f) => ({ ...f, label: L.labelOf(f.k), desc: L.descOf(f.k) }));
    $("why-note").textContent = `Compara a lista dos ${st.bad.length} oponentes contra quem ${d.name} vai pior (${st.bad.map((r) => `${shortDeck(r.o)} ${pct1(r.wr)}`).join(", ")}) com a dos ${st.good.length} contra quem vai melhor. Barra vermelha: o oponente difícil tem mais cartas com aquilo (por 60); azul: os fáceis têm mais. Confrontos com pelo menos ${MU_MIN} partidas. Associação, não prova de causa.`;
    divergingChart("c-why", "why-wrap", feats, (f) => f.diff, css("--critical"), css("--series-1"),
      (f) => [`Oponentes difíceis: ${f1(f.bad)} cartas · fáceis: ${f1(f.good)}`, `Correlação com o win rate de ${d.name}: ${f.corr.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`, ...wrapText(f.desc, 55)]);
  }
  // win rate by opponent category + worst/best opponents
  const C = S.duels.decks.categories, byCat = new Map(C.order.map((c) => [c, [0, 0]]));
  era.matchups.filter((m) => m[0] === idx && m[1] !== idx).forEach(([, j, g, w]) => { const r = catOf(era.decks[j].key, ek); if (r && byCat.has(r.cat)) { byCat.get(r.cat)[0] += g; byCat.get(r.cat)[1] += w; } });
  $("whycat-title").textContent = `Contra cada categoria: ${d.name}`;
  $("whycat-note").textContent = "Win rate somando os confrontos com todos os decks de cada categoria.";
  const t = $("t-whycat"); t.replaceChildren(); const h = t.createTHead().insertRow(); ["Categoria do oponente", "Partidas", "Win rate"].forEach((x, i) => h.append(el("th", i ? "num" : "", x)));
  const b = t.createTBody();
  C.order.forEach((c) => { const [g, w] = byCat.get(c); const tr = b.insertRow(); tr.style.cursor = "default"; catCell(tr, { cat: c }); numCell(tr, g.toLocaleString("pt-BR")); const wc = numCell(tr, g ? pct1(w / g) : "–"); if (g) wc.className += wrClass(w / g); });
  // worst and best opponents with what stands out in their list
  const glob = new Map(); ops.forEach((r) => r.comp.forEach((v, k) => glob.set(k, (glob.get(k) || 0) + v * r.g))); const G = ops.reduce((a, r) => a + r.g, 0);
  const stand = (r) => [...r.comp].filter(([k]) => !L.skip(k)).map(([k, v]) => [k, v - (glob.get(k) || 0) / G]).sort((a, b2) => b2[1] - a[1]).slice(0, 2).map(([k, v]) => `${L.labelOf(k)} (+${f1(v)})`).join(", ");
  const sorted = [...ops].sort((a, b2) => a.wr - b2.wr), pick = sorted.slice(0, 4).concat(sorted.slice(-3).reverse());
  $("whyops-note").textContent = "Piores e melhores confrontos, e o que mais se destaca na lista de cada oponente em relação à média dos oponentes (cartas por 60).";
  const t2 = $("t-whyops"); t2.replaceChildren(); const h2 = t2.createTHead().insertRow(); ["Oponente", "Win rate", "Destaque na lista do oponente"].forEach((x, i) => h2.append(el("th", i === 1 ? "num" : "", x)));
  const b2 = t2.createTBody();
  pick.forEach((r, i) => { const tr = b2.insertRow(); tr.style.cursor = "default"; if (i === 4) tr.style.borderTop = "2px solid var(--border)";
    const nc = tr.insertCell(); nc.className = "name"; nc.append(inkDots(r.o.colors), document.createTextNode(r.o.name)); nc.append(el("small", null, `${r.g.toLocaleString("pt-BR")} partidas`));
    const wc = numCell(tr, pct1(r.wr)); wc.className += wrClass(r.wr); const sc = tr.insertCell(); sc.className = "small"; sc.style.whiteSpace = "normal"; sc.textContent = stand(r); });
}
function renderVsCategory(ek) {
  const box = $("vscat-box"), T = S.duels.taxonomy, era = deckEraData(ek), C = S.duels.decks.categories;
  if (!T || !C || !(era.matchups || []).length) { box.hidden = true; return; }
  box.hidden = false; syncView();
  const cat = S.view.vsCat, level = S.view.whyLevel, L = levelFns(T, level), f1 = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const agg = new Map();
  era.matchups.forEach(([i, j, g, w]) => { if (i === j) return; const r = catOf(era.decks[j].key, ek); if (!r || r.cat !== cat) return; const a = agg.get(i) || [0, 0]; a[0] += g; a[1] += w; agg.set(i, a); });
  const rows = [...agg].filter(([i, [g]]) => g >= 500 && Object.keys(era.decks[i].list || {}).length).map(([i, [g, w]]) => ({ o: era.decks[i], g, wr: w / g, comp: deckComp(era.decks[i], T, L.keyOf) }));
  $("vscat-title").textContent = `O que funciona contra ${cat}`;
  if (rows.length < 6) { $("vscat-note").textContent = "Poucos decks com confrontos suficientes contra essa categoria nesta expansão."; upsert("c-vscat", { type: "bar", data: { labels: [], datasets: [] } }); return; }
  const keys = [...new Set(rows.flatMap((r) => [...r.comp.keys()]))].filter((k) => !L.skip(k));
  const st = driverStats(rows, keys);
  const feats = st.feats.map((f) => ({ ...f, gain: -f.diff, label: L.labelOf(f.k), desc: L.descOf(f.k) })).filter((f) => Math.abs(f.gain) >= 0.5).sort((a, b) => b.gain - a.gain);
  const nm = (r) => shortDeck(r.o);
  $("vscat-note").textContent = `Compara a lista dos ${st.good.length} decks que mais ganham de ${cat} (${st.good.slice().reverse().map((r) => `${nm(r)} ${pct1(r.wr)}`).join(", ")}) com a dos ${st.bad.length} que mais perdem (${st.bad.map((r) => `${nm(r)} ${pct1(r.wr)}`).join(", ")}). Barra verde: quem vai bem contra ${cat} tem mais cartas com aquilo (por 60); vermelha: quem vai mal tem mais. Decks com pelo menos 500 partidas contra a categoria. O nível (função, subfunção, habilidade) é o mesmo do gráfico acima.`;
  divergingChart("c-vscat", "vscat-wrap", feats, (f) => f.gain, css("--good") || "#1baf7a", css("--critical"),
    (f) => [`Quem vai bem: ${f1(f.good)} cartas · quem vai mal: ${f1(f.bad)}`, `Correlação com o win rate contra ${cat}: ${f.corr.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`, ...wrapText(f.desc, 55)]);
}

/** ident -> the card to show: Normal printing from a main set (not promo), cheapest */
function refCards() {
  if (S._refCards) return S._refCards;
  const m = new Map(), score = (c) => (c.printing === "Normal" ? 0 : 2) + (/^\d+$/.test(c.setCode || "") ? 0 : 1);
  S.cards.forEach((c) => { const h = m.get(c.ident); if (!h || score(c) < score(h) || (score(c) === score(h) && (c.price || 99) < (h.price || 99))) m.set(c.ident, c); });
  return (S._refCards = m);
}
/* ---------- Meta tab (public): our analyses, built from insights.json ---------- */
function renderInsights() {
  const I = S.ins; if (!I || !S.fn) return;
  const T = S.fn, O = I.categories.order, f1 = (v) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const seg = $("in-cat-seg"); if (!seg.children.length) O.forEach((c) => { const b = el("button", null, "vs " + c); b.type = "button"; b.dataset.v = c; b.title = CAT_DESC[c]; b.onclick = () => { S.view.insCat = c; renderInsights(); }; seg.append(b); });
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === S.view.insCat));
  // 1. categories
  $("in-cat-note").textContent = `Classificamos os decks do ranqueado online (${I.eraName}) em quatro categorias pelo jeito como ganham: velocidade das vitórias, duração das partidas, curva, quantidade de personagens, wipes, remoção e compra. Presença = fatia das partidas jogadas com decks de cada categoria. Atualizado em ${I.updated.split("-").reverse().join("/")}.`;
  const kp = $("in-cat-kpis"); kp.replaceChildren();
  O.forEach((c) => { const k = el("div", "kpi"); const lab = el("span", "kpi-label tip", c); lab.title = CAT_DESC[c]; const v = el("span", "kpi-value", pct1(I.categories.presence[c])); v.style.color = catColor(c);
    k.append(lab, v, el("span", "kpi-sub", CAT_DESC[c])); kp.append(k); });
  const tc = $("t-in-cent"); tc.replaceChildren(); const hc = tc.createTHead().insertRow(); ["", ...O].forEach((h, i) => { const th = el("th", i ? "num tip" : "", h); if (i) th.title = `${h}: ${CAT_DESC[h]}`; hc.append(th); });
  const bc = tc.createTBody();
  I.features.forEach((l, k) => { const tr = bc.insertRow(); tr.style.cursor = "default"; tr.insertCell().textContent = l;
    const vals = O.map((c) => I.categories.centroid[c] ? I.categories.centroid[c][k] : null), mx = Math.max(...vals.filter((v) => v != null));
    vals.forEach((v) => { const td = numCell(tr, v == null ? "–" : f1(v)); if (v === mx) td.style.fontWeight = "700"; }); });
  // 2. what beats each category: top third vs bottom third of decks against it, by função (left) and in detail (right)
  const c = S.view.insCat, B = I.beats[c], lv = S.view.insLevel;
  $("in-beat-title").textContent = `O que funciona contra ${c}`;
  document.querySelectorAll("#in-lv-seg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === lv));
  const good = css("--good") || "#1baf7a", bad = css("--critical");
  const lab = { func: (k) => T.funcs[k], sub: (k) => `${T.funcs[T.subs[k][0]]} › ${T.subs[k][1]}`, hab: (k) => `${T.subs[T.habs[k][0]][1]} › ${T.habs[k][1]}` };
  const dsc = { func: T.desc.funcs, sub: T.desc.subs, hab: T.desc.habs };
  const items = (level) => Object.entries((B && B[level]) || {}).map(([k, v]) => ({ k: +k, level, v, label: lab[level](+k), desc: dsc[level][+k] }));
  const tip = (e) => [`${e.v > 0 ? "+" : ""}${f1(e.v)} cartas por 60 nos decks que vão melhor contra ${c}`, ...wrapText(e.desc, 55), "Clique para ver essas cartas no meta."];
  const go = (e) => goCards(e.level, e.k);
  divergingChart("c-in-eff", "in-eff-wrap", items("func"), (e) => e.v, good, bad, tip, go);
  divergingChart("c-in-beat", "in-beat-wrap", items(lv), (e) => e.v, good, bad, tip, go);
  $("in-beat-note").textContent = B
    ? `Separamos os ${B.n} decks do meta com partidas suficientes contra ${c} em três grupos pelo win rate contra ${c} e comparamos as listas do terço que mais ganha com as do terço que mais perde. Verde: o que os vencedores têm a mais (cartas por 60); vermelho: o que têm a menos. Uma carta conta em cada função que tem. À esquerda, as funções; à direita, o detalhe. Clique numa barra para ver as cartas na aba Cartas. É associação, não causa: os decks que vão bem podem ter outras coisas em comum.`
    : `Não há decks suficientes com partidas contra ${c} para esta comparação.`;
  // 3. deck tiles
  $("in-decks-note").textContent = "Listas de referência escolhidas por nós entre as builds mais jogadas de cada arquétipo, com crédito. Clique num deck para ver a ficha.";
  const box = $("in-decks"); box.replaceChildren();
  I.decks.forEach((d) => { const b = el("button", "deck-tile"); b.type = "button"; b.setAttribute("aria-pressed", S.insDeck === d.key);
    b.append(inkDots(d.colors), document.createTextNode(shortDeck(d)), el("small", null, `${d.colors.join("/")} · ${d.category}`));
    b.onclick = () => { S.insDeck = S.insDeck === d.key ? null : d.key; renderInsights(); if (S.insDeck) $("in-sheet").scrollIntoView({ behavior: "smooth", block: "start" }); };
    box.append(b); });
  $("in-credit").textContent = I.credit;
  renderInsightSheet();
}
function renderInsightSheet() {
  const I = S.ins, T = S.fn, d = I.decks.find((x) => x.key === S.insDeck), sh = $("in-sheet");
  if (!d) { sh.hidden = true; return; }
  sh.hidden = false;
  const byId = refCards();
  const items = Object.entries(d.list).map(([id, n]) => ({ c: byId.get(id) || { name: id, ident: id }, n }));
  const total = items.reduce((a, x) => a + x.n, 0);
  $("in-sh-title").textContent = d.name;
  $("in-sh-sub").textContent = `${d.category} · ${total} cartas · lista de referência: ${d.source} · preço da lista ≈ ${usd0(items.reduce((a, x) => a + x.n * (x.c.price || 0), 0))} (TCGplayer, impressão normal)`;
  const vs = $("in-sh-vs"); vs.replaceChildren();
  I.categories.order.forEach((c) => { const l = d.vsCategory[c]; if (!l) return; const ch = el("span", "chip" + (l === "favorável" ? " good" : l === "desfavorável" ? " bad" : ""), `vs ${c}: ${l}`); ch.title = CAT_DESC[c]; vs.append(ch); });
  const subLabel = (k) => `${T.funcs[T.subs[k][0]]} › ${T.subs[k][1]}`;
  [["in-sh-hard", d.struggles], ["in-sh-easy", d.thrives]].forEach(([id, arr]) => { const ul = $(id); ul.replaceChildren();
    (arr.length ? arr : [null]).forEach((k) => { const li = el("li", k == null ? null : "tip", k == null ? "Sem padrão claro nos dados." : subLabel(k)); if (k != null) li.title = T.desc.subs[k]; ul.append(li); }); });
  const parts = compParts(T, items.map((x) => ({ fx: S.fn.byIdent[x.c.ident], w: x.n, name: x.c.name })), "func", total);
  drawComposition(parts, "func", "c-in-sh", "t-in-sh-comp", total);
  const t = $("t-in-sh"); t.replaceChildren(); const h = t.createTHead().insertRow(); [["Cópias", "num"], ["Carta", ""], ["Custo", "num"], ["Funções", ""], ["Preço", "num"]].forEach(([x, cl]) => h.append(el("th", cl, x)));
  const b = t.createTBody();
  items.sort((a, b2) => (+a.c.cost || 0) - (+b2.c.cost || 0) || a.c.name.localeCompare(b2.c.name)).forEach((x) => { const tr = b.insertRow(); tr.tabIndex = 0; if (x.c.id) tr.onclick = () => openDetail(x.c);
    numCell(tr, x.n); if (x.c.id) nameCell(tr, x.c); else tr.insertCell().textContent = x.c.name; numCell(tr, x.c.cost || "–");
    const fc = tr.insertCell(); fc.className = "small"; fc.textContent = [...new Set((S.fn.byIdent[x.c.ident] || []).map(([hi]) => T.funcs[T.subs[T.habs[hi][0]][0]]))].join(", ") || "–";
    numCell(tr, usd(x.c.price)); });
  $("in-sh-analyze").onclick = () => { S.dlText = items.map((x) => `${x.n} ${x.c.ident || x.c.name}`).join("\n"); $("dl-text").value = S.dlText; try { localStorage.setItem("lorcana-decklist", S.dlText); } catch (e) { /* storage off */ } S.tab = "deck"; changed(); };
}

/* ---------- Concepts tab (public): explains categories, funções, habilidades and momentos, with live examples ---------- */
function openInsDeck(key) { S.insDeck = key; S.tab = "insights"; changed(); setTimeout(() => $("in-sheet").scrollIntoView({ behavior: "smooth", block: "start" }), 50); }
function renderConcepts() {
  if (S._cx || !S.fn) return; S._cx = true;
  const T = S.fn, I = S.ins, f1 = (v) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  const pop = I ? I.popular : [], popRank = new Map(pop.map((k, i) => [k, i]));
  const allIdents = Object.keys(T.byIdent).sort((a, b) => (popRank.has(a) ? popRank.get(a) : 1e6) - (popRank.has(b) ? popRank.get(b) : 1e6) || a.localeCompare(b));
  const examples = (test, n = 3) => { const out = []; for (const k of allIdents) { if (test(T.byIdent[k] || [])) { out.push(k); if (out.length >= n) break; } } return out; };
  const linkBtn = (txt, fn, tip) => { const b = el("button", "cx-link", txt); b.type = "button"; b.onclick = fn; if (tip) b.title = tip; return b; };
  const para = (parent, html) => { const p = el("p"); p.innerHTML = html; parent.append(p); return p; };
  const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const subLab = (k) => `${T.funcs[T.subs[k][0]]} › ${T.subs[k][1]}`;

  // 1. categories
  const cx = $("cx-cat"); cx.replaceChildren(el("h2", null, "Categorias de deck"));
  const intro = el("div", "cx-prose"); cx.append(intro);
  para(intro, "A categoria diz <b>como o deck ganha</b>, não quais cores usa. Duas listas Amethyst/Steel podem estar em categorias diferentes se uma fecha o jogo cedo e a outra vence no cansaço.");
  para(intro, "Nenhuma regra decide sozinha. Para cada deck olhamos várias características ao mesmo tempo: quantas vitórias saem até o turno 7, quanto duram as vitórias e as derrotas (e a diferença entre elas), quantos personagens baratos, o custo médio dos personagens, o total de personagens e quantas cartas de wipe, remoção e compra a lista tem. O deck vai para a categoria cujo perfil típico é o mais parecido, usando como referência decks que todo mundo concorda em classificar. O nome do arquétipo pesa um pouco, e alguns casos foram decididos à mão por quem joga (por exemplo, Amber/Sapphire Control é Controle; Mouse House e Lilo & Stitch Songs são Tempo).");
  if (I) {
    const O = I.categories.order, grid = el("div", "cx-cats"); cx.append(grid);
    const featIdx = (name) => I.features.indexOf(name);
    O.forEach((c) => {
      const box = el("div", "cx-cat"), h = el("h3"), dot = el("i"); dot.style.background = catColor(c); h.append(dot, document.createTextNode(c)); box.append(h);
      box.append(el("p", null, CAT_DESC[c]));
      const cen = I.categories.centroid[c];
      if (cen) {
        const others = O.filter((o) => o !== c && I.categories.centroid[o]);
        const hi = I.features.map((l, k) => ({ l, k, d: cen[k] - others.reduce((a, o) => a + I.categories.centroid[o][k], 0) / others.length }))
          .filter((x) => x.k < 7).sort((a, b) => b.d - a.d);
        const pc = featIdx("Personagens"), cc = featIdx("Custo médio dos personagens");
        para(box, `Perfil médio: <b>${f1(cen[pc])}</b> personagens por 60 cartas, custo médio <b>${f1(cen[cc])}</b>. Tem mais <b>${esc(hi[0].l.toLowerCase())}</b> (${f1(cen[hi[0].k])} cartas) e <b>${esc(hi[1].l.toLowerCase())}</b> (${f1(cen[hi[1].k])}) que a média das outras categorias. Presença no meta: ${pct1(I.categories.presence[c])} das partidas.`);
      }
      const ds = I.decks.filter((d) => d.category === c);
      if (ds.length) { const p = el("p"); p.append(document.createTextNode("Decks de referência: ")); ds.forEach((d, i) => { if (i) p.append(document.createTextNode(", ")); p.append(linkBtn(shortDeck(d), () => openInsDeck(d.key), d.name)); }); box.append(p); }
      // matchups of the reference decks of this category, summarised
      const vs = O.filter((o) => o !== c).map((o) => { const ls = ds.map((d) => d.vsCategory[o]).filter(Boolean); const sc = ls.length ? ls.reduce((a, l) => a + (l === "favorável" ? 1 : l === "desfavorável" ? -1 : 0), 0) / ls.length : 0; return { o, sc, n: ls.length }; }).filter((x) => x.n);
      const goodVs = vs.filter((x) => x.sc >= 0.34).map((x) => x.o), badVs = vs.filter((x) => x.sc <= -0.34).map((x) => x.o);
      if (vs.length) para(box, `Nas listas de referência desta categoria: ${!goodVs.length && !badVs.length ? "fica equilibrada contra as outras categorias" : [goodVs.length ? `costuma ir bem contra <b>${goodVs.join(", ")}</b>` : "", badVs.length ? `sofre contra <b>${badVs.join(", ")}</b>` : ""].filter(Boolean).join("; ")}.`);
      // why: what the decks that beat this category have more of, with a real example
      const B = I.beats[c];
      if (B && B.sub) {
        const ent = Object.entries(B.sub).map(([k, v]) => [+k, v]), pos = ent.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]), neg = ent.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]);
        if (pos.length) {
          const [sk, sv] = pos[0];
          const hasSub = (k) => (T.byIdent[k] || []).some(([hi]) => T.habs[hi][0] === sk);
          let best = null;
          I.decks.filter((d) => d.vsCategory[c] === "favorável" && d.category !== c).forEach((d) => { const cards = Object.entries(d.list).filter(([k]) => hasSub(k)).sort((a, b) => b[1] - a[1]); const tot = cards.reduce((a, [, n]) => a + n, 0); if (tot && (!best || tot > best.tot)) best = { d, cards, tot }; });
          let txt = `<b>Por que se ganha de ${c}:</b> os decks que mais vencem ${c} têm, em média, ${f1(sv)} cartas a mais de <b>${esc(subLab(sk))}</b> por 60`;
          if (neg.length) txt += ` e ${f1(-neg[0][1])} a menos de ${esc(subLab(neg[0][0]))}`;
          txt += ".";
          if (best) txt += ` Exemplo: ${esc(shortDeck(best.d))} (favorável contra ${c}) usa ${best.cards.slice(0, 3).map(([k, n]) => `${n}× ${esc(k)}`).join(", ")}.`;
          para(box, txt);
        }
      }
      grid.append(box);
    });
  }

  // 2. funções > subfunções > habilidades
  const fx = $("cx-fn"); fx.replaceChildren(el("h2", null, "Funções e habilidades"));
  const fi = el("div", "cx-prose"); fx.append(fi);
  para(fi, "Cada carta é descrita pelo que ela faz em jogo, em três níveis: a <b>função</b> (o papel geral), a <b>subfunção</b> (o jeito de cumprir esse papel) e a <b>habilidade</b> (o efeito concreto). Uma carta com vários efeitos aparece em todas as funções que cumpre. Os exemplos são as cartas mais jogadas no meta atual com aquela habilidade; clique no nome de uma habilidade para ver todas as cartas dela na aba Cartas.");
  T.funcs.forEach((fn, fIdx) => {
    const d = el("details", "cx-fn"); if (fIdx === 0) d.open = true;
    const sm = el("summary", null, fn); sm.append(el("small", null, T.desc.funcs[fIdx])); d.append(sm);
    T.subs.forEach(([sf, sn], sIdx) => {
      if (sf !== fIdx) return;
      const sb = el("div", "cx-sub");
      if (sn !== fn) { const h4 = el("h4"); h4.append(linkBtn(sn, () => goCards("sub", sIdx), "Ver as cartas na aba Cartas"), document.createTextNode(` — ${T.desc.subs[sIdx]}`)); sb.append(h4); }
      T.habs.forEach(([hs, hn], hIdx) => {
        if (hs !== sIdx) return;
        const row = el("div", "cx-hab");
        row.append(linkBtn(hn, () => goCards("hab", hIdx), "Ver as cartas na aba Cartas"), document.createTextNode(`: ${T.desc.habs[hIdx]} `));
        const ex = examples((list) => list.some(([h]) => h === hIdx));
        if (ex.length) row.append(el("span", "cx-ex", `Ex.: ${ex.join(" · ")}`));
        sb.append(row);
      });
      d.append(sb);
    });
    fx.append(d);
  });

  // 3. momentos
  const mo = $("cx-mom"); mo.replaceChildren(el("h2", null, "Momento"));
  const mi = el("div", "cx-prose"); mo.append(mi);
  para(mi, "O momento é um eixo separado da função: diz <b>quando</b> a habilidade acontece. Uma remoção que acontece ao jogar o personagem é bem diferente de uma que só acontece se ele questar e sobreviver. Palavras-chave como Evasive, Ward e Resist contam como Contínuo; as exceções são Challenger (ao desafiar), Shift (ao jogar), Singer (ao cantar), Support (ao questar) e Boost (ativada).");
  const ul = el("ul", "cx-prose"); mo.append(ul);
  T.moments.forEach((m, k) => { if (m === "—") return; const li = el("li"); li.innerHTML = `<b>${esc(m)}</b>: ${esc(T.desc.moments[k])} `;
    const ex = examples((list) => list.some(([, mm]) => mm === k)); if (ex.length) li.append(el("span", "cx-ex", `Ex.: ${ex.join(" · ")}`)); ul.append(li); });

  // 4. counting rules
  const ru = $("cx-rules"); ru.replaceChildren(el("h2", null, "Regras de contagem"));
  const multi = allIdents.find((k) => fnNames(k).length >= 3) || allIdents.find((k) => fnNames(k).length >= 2);
  const rl = el("ul", "cx-prose"); ru.append(rl);
  [
    `<b>Uma carta conta inteira em cada função que cumpre.</b> Ela não é dividida: se faz remoção e ganha lore, conta uma vez em Remoção e uma vez em Pressão de lore.${multi ? ` Exemplo: ${esc(multi)} conta em ${esc(fnNames(multi).join(", "))}.` : ""} Por isso a soma das funções de um deck passa de 60, e a pizza de composição mostra a fatia de cada papel, não de cartas.`,
    "<b>Menção não é palavra-chave.</b> Uma carta que diz “personagens com Evasive ganham…” ou “desafiar um personagem com Ward” não ganha Evasive nem Ward por isso.",
    "<b>Remoção é contra personagens prontos.</b> Dano, banir, exaurir, mover dano ou mandar para o inkwell ou o fundo do deck. Um desafio comum num personagem exaurido não conta como remoção.",
    "<b>Draw conta o saldo.</b> Um personagem que compra 2 e descarta 1 fica na mesa e dá +1 carta: é card advantage. Uma ação que só repõe a si mesma (comprar 1, ou comprar 2 e descartar 1, como Strike a Good Match) não ganha nada: fica em Filter › Repõe a si mesma.",
    "<b>Pressão de lore</b> é ganhar lore por efeito ou ter personagens que questam para 2 ou mais com custo efetivo baixo (lore ÷ custo efetivo ≥ 2/3, em que custo efetivo é o menor entre o custo e o Shift). O lore de um personagem Reckless não conta, porque ele não questa.",
    "<b>Músicas contam pelo efeito.</b> Ser música não as torna aceleração; cantar com Singer conta como Cortar custo no personagem que canta.",
    "<b>Defesa só no seu turno é para desafiar.</b> Resist, Ward, vontade ou imunidade a dano de desafio que valem só durante o seu turno (Judy Hopps – Lead Detective, Mulan – Standing Her Ground) contam em Controle de mesa › Desafio, não em Proteção.",
    "<b>Corpo</b> são personagens sem habilidade (vanilla), que valem pelos números. <b>Outros</b> são as sobras: desvantagens do próprio personagem, regras de montagem de deck e algumas locations.",
  ].forEach((t) => { const li = el("li"); li.innerHTML = t; rl.append(li); });

  // 5. how to read
  const rd = $("cx-read"); rd.replaceChildren(el("h2", null, "Como ler as análises"));
  const rr = el("ul", "cx-prose"); rd.append(rr);
  [
    "<b>Composição (cartas por 60):</b> quantas cartas da lista cumprem cada função, numa lista de 60. Uma carta pode contar em mais de uma função.",
    "<b>O que funciona contra uma categoria (aba Meta):</b> dividimos os decks do meta em três grupos pelo win rate contra aquela categoria e comparamos as listas do terço que mais ganha com as do terço que mais perde. Barra verde = o que os vencedores têm a mais; vermelha = o que têm a menos. Mostra associação, não causa.",
    "<b>Ficha de deck:</b> o confronto contra cada categoria aparece só como rótulo — favorável (53% ou mais), desfavorável (47% ou menos) ou equilibrado. “Sofre contra decks com” compara os oponentes que o deck vence com os que o derrotam.",
    "<b>Analisar deck:</b> a categoria vem do perfil mais parecido. O win rate contra cada categoria é estimado por uma fórmula ajustada com os decks do meta, e o site mostra a margem de erro medida (testando a fórmula em cada deck deixado de fora). O simulador refaz a conta quando você troca cartas; as sugestões vêm das cartas mais jogadas que cumprem a função que falta.",
    S.dcur ? "<b>Aba Cartas:</b> a presença de cada carta é calculada sobre os decks do Duels.ink, ponderados por partidas, e a base muda com os filtros de cor, categoria e deck." : "<b>Aba Cartas:</b> a presença de cada carta é calculada sobre as listas de referência, e a base muda com os filtros de cor, categoria e deck.",
    `<b>Fonte e limites:</b> as análises usam dados públicos de partidas online do Duels.ink (ranqueado Core BO1)${I ? `, ${esc(I.eraName)}` : ""}, e as listas de referência são escolhidas por nós. São poucas dezenas de decks e o meta muda a cada coleção: leia os números como tendência, não como verdade exata.`,
  ].forEach((t) => { const li = el("li"); li.innerHTML = t; rr.append(li); });
}

/* ---------- decklist analyser (public) ---------- */
const normName = (n) => n.toLowerCase().replace(/[\u2018\u2019\u02bc`´]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/\s*-\s*/g, " - ").replace(/\s+/g, " ").replace(/\s*\([^)]*\)\s*$/, "").trim();
let identIndex = null;
function cardByName(name) {
  if (!identIndex) {
    identIndex = new Map();
    S.cards.forEach((c) => { const k = normName(c.ident || c.name), have = identIndex.get(k);
      const better = !have || (c.printing === "Normal" && have.printing !== "Normal") || (c.printing === have.printing && c.price && (!have.price || c.price < have.price));
      if (better) identIndex.set(k, c); });
  }
  return identIndex.get(normName(name)) || null;
}
function parseDecklist(text) {
  const items = new Map(), bad = [];
  text.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim(); if (!line || /^(#|\/\/)/.test(line)) return;
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (!m) { bad.push(line); return; }
    const c = cardByName(m[2]);
    if (!c) { bad.push(line); return; }
    const it = items.get(c.ident) || { c, n: 0 }; it.n += +m[1]; items.set(c.ident, it);
  });
  return { items: [...items.values()], bad };
}
function renderDeckAnalysis() {
  if (!S.fn) return;
  syncView();
  const { items, bad } = parseDecklist(S.dlText || "");
  $("dl-warn").textContent = bad.length ? `Não reconheci ${bad.length} linha(s): ${bad.slice(0, 6).join(" · ")}${bad.length > 6 ? " …" : ""}` : "";
  const out = $("dl-out");
  if (!items.length) { out.hidden = true; $("dl-status").textContent = S.dlText ? "" : "Cole uma lista e clique em Analisar."; return; }
  out.hidden = false;
  const T = S.fn, fxOf = (c) => T.byIdent[c.ident] || [];
  const total = items.reduce((a, x) => a + x.n, 0);
  $("dl-status").textContent = `${items.length} cartas diferentes reconhecidas.`;
  $("dk-cards").textContent = total; $("dk-cards-sub").textContent = total === 60 ? "deck completo" : total < 60 ? `faltam ${60 - total} para 60` : `${total - 60} acima de 60`;
  const inks = [...new Set(items.flatMap((x) => inkList(x.c)))]; $("dk-inks").textContent = inks.join(" / ") || "–";
  const chars = items.filter((x) => x.c.type === "Character"), nch = chars.reduce((a, x) => a + x.n, 0);
  $("dk-cost").textContent = nch ? (chars.reduce((a, x) => a + x.n * (+x.c.cost || 0), 0) / nch).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "–";
  $("dk-cost-sub").textContent = `${nch} personagens · ${chars.filter((x) => +x.c.cost <= 3).reduce((a, x) => a + x.n, 0)} de custo até 3`;
  $("dk-price").textContent = usd0(items.reduce((a, x) => a + x.n * (x.c.price || 0), 0));
  // composition
  const level = S.view.dlLevel, parts = compParts(T, items.map((x) => ({ fx: fxOf(x.c), w: x.n, name: x.c.name })), level, total);
  $("dl-comp-note").textContent = "Classificação nossa, feita a partir do texto das cartas (passe o mouse nos nomes para ver a definição)." + COMP_NOTE;
  drawComposition(parts, level, "c-dl-comp", "t-dl-comp", total);
  // cost curve, stacked by card type
  const TYPES = [["Character", "Personagens"], ["Action", "Ações e músicas"], ["Item", "Itens"], ["Location", "Locations"]];
  const col = COMP_COLORS[matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"];
  const maxC = Math.max(7, ...items.map((x) => +x.c.cost || 0)), costs = Array.from({ length: maxC }, (_, i) => i + 1);
  const ds = TYPES.map(([t, l], i) => ({ label: l, backgroundColor: col[i], data: costs.map((k) => items.filter((x) => x.c.type === t && +x.c.cost === k).reduce((a, x) => a + x.n, 0)) })).filter((d) => d.data.some((v) => v));
  barChart("c-dl-curve", costs.map(String), ds, { stacked: true, legend: true, fmt: (v) => v, tooltip: (i, di) => `${ds[di].label}: ${ds[di].data[i]} cópias (custo ${costs[i]})` });
  // moments
  const mom = T.moments.map(() => 0);
  items.forEach((x) => new Set(fxOf(x.c).map(([, mi]) => mi)).forEach((mi) => { mom[mi] += x.n; }));
  const mk = T.moments.map((m, i) => i).filter((i) => mom[i] && T.moments[i] !== "—").sort((a, b) => mom[b] - mom[a]);
  barChart("c-dl-mom", mk.map((i) => T.moments[i]), [{ data: mk.map((i) => mom[i]) }], { horizontal: true, fmt: (v) => v, tooltip: (i) => [`${mom[mk[i]]} cópias`, ...wrapText(T.desc.moments[mk[i]], 50)] });
  renderDeckMetaRead(items);
  // card table
  const t = $("t-dl"); t.replaceChildren();
  const hr = t.createTHead().insertRow(); [["Cópias", "num"], ["", ""], ["Carta", ""], ["Custo", "num"], ["Função · habilidade · momento", ""], ["Preço", "num"], ["Subtotal", "num"]].forEach(([h, c]) => hr.append(el("th", c, h)));
  const b = t.createTBody();
  items.sort((a, b2) => (+a.c.cost || 0) - (+b2.c.cost || 0) || a.c.name.localeCompare(b2.c.name)).forEach((x) => {
    const tr = b.insertRow(); tr.tabIndex = 0; tr.onclick = () => openDetail(x.c);
    numCell(tr, x.n); imgCell(tr, x.c); nameCell(tr, x.c); numCell(tr, x.c.cost || "–");
    const fc = tr.insertCell(); fc.className = "small"; fc.style.whiteSpace = "normal"; fc.style.minWidth = "220px";
    fxOf(x.c).forEach(([hi, mi], k) => { const si = T.habs[hi][0], fi = T.subs[si][0];
      const sp = el("span", "tip", `${T.funcs[fi]} · ${T.habs[hi][1]} · ${T.moments[mi]}`); sp.title = T.desc.habs[hi] || ""; if (k) fc.append(el("br")); fc.append(sp); });
    numCell(tr, usd(x.c.price)); numCell(tr, usd(x.n * (x.c.price || 0)));
  });
}

/* ---------- decklist vs the meta (private build only: uses Duels.ink lists and matchups) ----------
   Model: for each opponent category, a ridge regression (weighted by games) of the win rate against that
   category on the deck's composition: cards per 60 in each of the 7 functions, characters per 60 and
   average character cost. Error = leave-one-out RMSE (hide one deck, fit on the rest, predict it). */
const FEAT_LABELS = ["Remoção", "Controle de mesa", "Draw", "Aceleração", "Disrupção", "Pressão de lore", "Proteção / evasão", "Personagens", "Custo médio dos personagens"];
const FEAT_UNIT = (k) => k === 8 ? "ponto de custo médio" : "carta";
function featuresOf(entries, T) {  // entries: [{fx, n, type, cost}]
  const x = new Array(9).fill(0); let tot = 0, ch = 0, chc = 0;
  entries.forEach(({ fx, n, type, cost }) => { tot += n;
    new Set((fx || []).map(([hi]) => T.subs[T.habs[hi][0]][0])).forEach((f) => { if (f < 7) x[f] += n; });
    if (type === "Character") { ch += n; chc += n * (+cost || 0); } });
  for (let k = 0; k < 7; k++) x[k] = tot ? x[k] * 60 / tot : 0;
  x[7] = tot ? ch * 60 / tot : 0; x[8] = ch ? chc / ch : 0;
  return x;
}
function solveLin(A, b) {  // Gaussian elimination with partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]]; const v = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / v; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}
function ridgeFit(X, y, w, lam = 3) {
  const n = X.length, p = X[0].length, W = w.reduce((a, v) => a + v, 0), wn = w.map((v) => v * n / W);
  const mu = Array.from({ length: p }, (_, k) => X.reduce((a, r, i) => a + wn[i] * r[k], 0) / n);
  const sd = Array.from({ length: p }, (_, k) => Math.sqrt(X.reduce((a, r, i) => a + wn[i] * (r[k] - mu[k]) ** 2, 0) / n) || 1);
  const Z = X.map((r) => [1, ...r.map((v, k) => (v - mu[k]) / sd[k])]);
  const A = Array.from({ length: p + 1 }, (_, i) => Array.from({ length: p + 1 }, (_, j) => Z.reduce((a, z, r) => a + wn[r] * z[i] * z[j], 0) + (i === j && i > 0 ? lam : 0)));
  const bv = Array.from({ length: p + 1 }, (_, i) => Z.reduce((a, z, r) => a + wn[r] * z[i] * y[r], 0));
  const beta = solveLin(A, bv);
  return { mu, sd, b0: beta[0], unit: beta.slice(1).map((v, k) => v / sd[k]) };  // unit: effect per +1 of the feature
}
const ridgePredict = (m, x) => m.b0 + x.reduce((a, v, k) => a + m.unit[k] * (v - m.mu[k]), 0);
function metaModel(ek) {
  S._mm = S._mm || {}; if (S._mm[ek]) return S._mm[ek];
  const era = deckEraData(ek), T = S.duels.taxonomy, C = S.duels.decks.categories;
  const decks = era.decks.map((d, i) => ({ d, i })).filter(({ d }) => d.games >= 1000 && Object.keys(d.list || {}).length).map(({ d, i }) => {
    const entries = Object.entries(d.list).map(([cid, n]) => { const dc = S.duelsById.get(cid), c = cardForCid(cid) || {}; return { fx: dc && dc.fx, n, type: c.type, cost: c.cost }; });
    return { d, i, x: featuresOf(entries, T), cat: (catOf(d.key, ek) || {}).cat }; });
  const G = decks.reduce((a, r) => a + r.d.games, 0);
  const avg = Array.from({ length: 9 }, (_, k) => decks.reduce((a, r) => a + r.x[k] * r.d.games, 0) / G);
  const sdAll = Array.from({ length: 9 }, (_, k) => Math.sqrt(decks.reduce((a, r) => a + r.d.games * (r.x[k] - avg[k]) ** 2, 0) / G) || 1);
  const cent = {}, presence = {}; const ct = catTotals(ek); let pres = 0;
  C.order.forEach((c) => { const ds = decks.filter((r) => r.cat === c), g = ds.reduce((a, r) => a + r.d.games, 0);
    cent[c] = g ? Array.from({ length: 9 }, (_, k) => ds.reduce((a, r) => a + r.x[k] * r.d.games, 0) / g) : null; presence[c] = ct.out.get(c).games; pres += presence[c]; });
  C.order.forEach((c) => { presence[c] /= pres || 1; });
  const models = {};
  C.order.forEach((c) => {
    const agg = new Map(); era.matchups.forEach(([i, j, g, w]) => { if (i === j || (catOf(era.decks[j].key, ek) || {}).cat !== c) return; const a = agg.get(i) || [0, 0]; a[0] += g; a[1] += w; agg.set(i, a); });
    const rows = decks.filter((r) => (agg.get(r.i) || [0])[0] >= 500).map((r) => ({ x: r.x, g: agg.get(r.i)[0], wr: agg.get(r.i)[1] / agg.get(r.i)[0], d: r.d }));
    if (rows.length < 8) return;
    const X = rows.map((r) => r.x), y = rows.map((r) => r.wr), w = rows.map((r) => r.g);
    let se = 0, sb = 0, W = 0;
    rows.forEach((r, k) => { const keep = rows.map((_, q) => q !== k), m = ridgeFit(X.filter((_, q) => keep[q]), y.filter((_, q) => keep[q]), w.filter((_, q) => keep[q]));
      const wy = y.filter((_, q) => keep[q]), ww = w.filter((_, q) => keep[q]), mean = wy.reduce((a, v, q) => a + v * ww[q], 0) / ww.reduce((a, v) => a + v, 0);
      se += (ridgePredict(m, r.x) - r.wr) ** 2; sb += (mean - r.wr) ** 2; W++; });
    const fit = ridgeFit(X, y, w);
    models[c] = { fit, rmse: Math.sqrt(se / W), base: Math.sqrt(sb / W), n: rows.length };
  });
  return (S._mm[ek] = { decks, avg, sdAll, cent, presence, models });
}
/** public: the same model shape as metaModel(), built from insights.json (no Duels.ink tables) */
function insModel() {
  if (S._insMM) return S._insMM;
  const I = S.ins, byId = refCards();
  const decks = I.decks.map((r) => ({ d: { name: r.name, colors: r.colors, key: r.key }, cat: r.category, identList: r.list,
    x: featuresOf(Object.entries(r.list).map(([id, n]) => { const c = byId.get(id) || {}; return { fx: S.fn.byIdent[id], n, type: c.type, cost: c.cost }; }), S.fn) }));
  return (S._insMM = { decks, avg: I.model.avg, sdAll: I.model.sdAll, cent: I.categories.centroid, presence: I.categories.presence, models: I.model.models });
}
function renderDeckMetaRead(items) {
  const box = $("dl-meta");
  const priv = !!(S.duels && S.duels.taxonomy && S.dcur && (S.dcur.matchups || []).length && S.duels.decks.categories);
  if (!priv && !S.ins) { box.hidden = true; return; }
  box.hidden = false; $("dlm-mu-box").hidden = !priv;
  const ek = priv ? S.duels.decks.current : null, era = priv ? deckEraData(ek) : null, T = priv ? S.duels.taxonomy : S.fn;
  const C = { order: catOrder() }, MM = priv ? metaModel(ek) : insModel(), eraName = priv ? eraInfo(ek).name : S.ins.eraName;
  const f1 = (v) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }), pp = (v) => (v > 0 ? "+" : "") + (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " p.p.";
  const mine = featuresOf(items.map((x) => ({ fx: S.fn.byIdent[x.c.ident], n: x.n, type: x.c.type, cost: x.c.cost })), T);
  // 1. category profile: distance to each category's average deck (standardized by the meta's spread)
  const dists = C.order.filter((c) => MM.cent[c]).map((c) => [c, Math.sqrt(mine.reduce((a, v, k) => a + ((v - MM.cent[c][k]) / MM.sdAll[k]) ** 2, 0) / 9)]);
  const ex = dists.map(([c, d]) => [c, Math.exp(-2 * d * d)]), exS = ex.reduce((a, [, v]) => a + v, 0);
  const memb = new Map(ex.map(([c, v]) => [c, v / exS])), mainCat = [...memb].sort((a, b) => b[1] - a[1])[0][0];
  const catColors = C.order.map((c) => catColor(c));
  barChart("c-dlm-cat", C.order, [{ data: C.order.map((c) => Math.round((memb.get(c) || 0) * 1000) / 10), backgroundColor: catColors }],
    { horizontal: true, fmt: (v) => v + "%", tooltip: (i) => [`${Math.round((memb.get(C.order[i]) || 0) * 100)}% de proximidade`, `Distância ao deck médio ${C.order[i]}: ${f1(dists.find(([c]) => c === C.order[i])[1])}`] });
  $("dlm-prof-note").textContent = `Quanto a composição do seu deck se parece com o deck médio de cada categoria do meta (${eraName}), olhando as 7 funções, a quantidade de personagens e o custo médio deles. Mais perto de ${mainCat}. A tabela mostra onde ele se afasta da categoria: em negrito, diferenças de mais de 3 cartas (ou 0,4 de custo médio) em relação à média de ${mainCat}.`;
  const tf = $("t-dlm-feat"); tf.replaceChildren(); const hf = tf.createTHead().insertRow();
  ["Média por 60 cartas", "Seu deck", ...C.order].forEach((h, i) => hf.append(el("th", i ? "num" : "", h)));
  const bf = tf.createTBody();
  FEAT_LABELS.forEach((l, k) => { const tr = bf.insertRow(); tr.style.cursor = "default"; tr.insertCell().textContent = l;
    const mc = numCell(tr, f1(mine[k])); const ref = MM.cent[mainCat]; if (ref && Math.abs(mine[k] - ref[k]) >= (k === 8 ? 0.4 : 3)) { mc.style.fontWeight = "700"; mc.className += mine[k] > ref[k] ? " up" : " down"; }
    C.order.forEach((c) => numCell(tr, MM.cent[c] ? f1(MM.cent[c][k]) : "–")); });
  // 2. estimated win rate vs each category (+ why)
  const preds = {}; C.order.forEach((c) => { const m = MM.models[c]; if (m) preds[c] = Math.max(0.15, Math.min(0.85, ridgePredict(m.fit, mine))); });
  const worstCat = Object.entries(preds).sort((a, b) => a[1] - b[1])[0][0];
  if (!S.view.dlmCat || !preds[S.view.dlmCat]) S.view.dlmCat = worstCat;
  const seg = $("dlm-cat-seg"); if (!seg.children.length) { C.order.forEach((c) => { const bt = el("button", null, "vs " + c); bt.type = "button"; bt.dataset.v = c; bt.onclick = () => { S.view.dlmCat = c; renderDeckAnalysis(); }; seg.append(bt); }); }
  seg.querySelectorAll("button").forEach((bt) => bt.setAttribute("aria-pressed", bt.dataset.v === S.view.dlmCat));
  const quality = (m) => { const g = 1 - m.rmse / m.base; return g >= 0.25 ? "boa" : g >= 0.12 ? "razoável" : "fraca"; };
  const overall = Object.entries(preds).reduce((a, [c, v]) => a + v * MM.presence[c], 0) / Object.keys(preds).reduce((a, c) => a + MM.presence[c], 0);
  $("dlm-est-note").textContent = `Estimativa pela composição: uma fórmula aprendida com os decks do meta liga as cartas por função e a curva ao win rate contra cada categoria. A margem é o erro típico da fórmula em teste com decks que ela não viu; "precisão" compara esse erro com o de chutar a média do meta. Win rate geral estimado, pesando pela presença de cada categoria: ${pct1(overall)}.`;
  const tc = $("t-dlm-cat"); tc.replaceChildren(); const hc = tc.createTHead().insertRow();
  ["Contra", "Presença", "Deck médio do meta", "Seu deck", "Margem", "Precisão"].forEach((h, i) => hc.append(el("th", i ? "num" : "", h)));
  const bc = tc.createTBody();
  C.order.forEach((c) => { const m = MM.models[c], tr = bc.insertRow(); tr.tabIndex = 0; if (c === S.view.dlmCat) tr.style.background = "var(--accent-wash)";
    tr.onclick = () => { S.view.dlmCat = c; renderDeckAnalysis(); }; catCell(tr, { cat: c }); numCell(tr, pct1(MM.presence[c]));
    if (!m) { [1, 2, 3, 4].forEach(() => numCell(tr, "–")); return; }
    numCell(tr, pct1(m.fit.b0)); const v = numCell(tr, pct1(preds[c])); v.className += wrClass(preds[c]); v.style.fontWeight = "700";
    numCell(tr, "± " + f1(m.rmse * 100) + " p.p."); const q = numCell(tr, quality(m)); q.title = `Erro da fórmula ${f1(m.rmse * 100)} p.p. contra ${f1(m.base * 100)} p.p. chutando a média (${m.n} decks)`; });
  const cm = MM.models[S.view.dlmCat];
  if (cm) {
    const contrib = FEAT_LABELS.map((l, k) => ({ label: l, k, v: cm.fit.unit[k] * (mine[k] - cm.fit.mu[k]), unit: cm.fit.unit[k], d: mine[k] - cm.fit.mu[k] })).filter((f) => Math.abs(f.v) >= 0.001);
    $("dlm-why-title").textContent = `Por que ${pct1(preds[S.view.dlmCat])} contra ${S.view.dlmCat}: parte de ${pct1(cm.fit.b0)} (deck médio)`;
    divergingChart("c-dlm-why", "dlm-why-wrap", contrib.map((f) => ({ ...f, val: f.v * 100 })), (f) => f.val, css("--good") || "#1baf7a", css("--critical"),
      (f) => [`${f.d >= 0 ? "+" : ""}${f1(f.d)} ${FEAT_UNIT(f.k)}${Math.abs(f.d) === 1 || f.k === 8 ? "" : "s"} em relação ao deck médio do meta`, `× ${pp(f.unit)} por ${FEAT_UNIT(f.k)} = ${pp(f.v)}`]);
  }
  // 3. per-deck matchups: blend of the nearest decks' real results and the formula for the opponent's category
  const cidIdent = new Map(); S.cards.forEach((c) => { const d = duelsOf(c); if (d) cidIdent.set(d.id, c.ident); });
  const byIdent = (list) => { const o = {}; Object.entries(list).forEach(([cid, cp]) => { const k = cidIdent.get(cid) || cid; o[k] = (o[k] || 0) + cp; }); return o; };
  const listOf = (r) => r.identList || byIdent(r.d.list);
  const mineI = {}; items.forEach((x) => { mineI[x.c.ident] = (mineI[x.c.ident] || 0) + x.n; });
  const cos = (a, b) => { let ab = 0, aa = 0, bb = 0; new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => { const x = a[k] || 0, y = b[k] || 0; ab += x * y; aa += x * x; bb += y * y; }); return aa && bb ? ab / Math.sqrt(aa * bb) : 0; };
  const near = MM.decks.map((r) => ({ ...r, sc: cos(mineI, listOf(r)), sp: 1 / (1 + Math.sqrt(mine.reduce((a, v, k) => a + ((v - r.x[k]) / MM.sdAll[k]) ** 2, 0) / 9)) }))
    .map((r) => ({ ...r, s: 0.6 * r.sc + 0.4 * r.sp })).sort((a, b) => b.s - a.s);
  const K = near.slice(0, 5).map((n) => ({ ...n, w: n.s ** 4 })), top = near[0];
  const alpha = Math.max(0, Math.min(1, (top.sc - 0.3) / 0.5));  // weight of the neighbours' real results
  if (priv) {
  const muOf = new Map(); era.matchups.forEach(([i, j, g, w]) => { if (i !== j) muOf.set(i + "|" + j, [g, w]); });
  const est = era.decks.map((o, j) => { let num = 0, den = 0, n = 0; K.forEach((k) => { const m = muOf.get(k.i + "|" + j); if (m && m[0] >= 50) { num += k.w * m[1] / m[0] * m[0]; den += k.w * m[0]; n += m[0]; } });
    const oc = (catOf(o.key, ek) || {}).cat, model = MM.models[oc] ? preds[oc] : null; if (model == null && !den) return null;
    const nb = den ? num / den : model, a = den && model != null ? alpha : den ? 1 : 0;
    const nbErr = den ? Math.max(0.02, 1.96 * Math.sqrt(nb * (1 - nb) / Math.max(n, 1))) : 0, mErr = model != null ? MM.models[oc].rmse : 0;
    return { o, oc, wr: a * nb + (1 - a) * model, err: a * nbErr + (1 - a) * mErr, n }; }).filter((e) => e && e.o.games >= 2000 && Object.keys(e.o.list || {}).length);
  const muTable = (id, rows) => { const t = $(id); t.replaceChildren(); const h = t.createTHead().insertRow(); ["Oponente", "Win rate estimado", "Margem"].forEach((x, i) => h.append(el("th", i ? "num" : "", x)));
    const b = t.createTBody(); rows.forEach((e) => { const tr = b.insertRow(); tr.style.cursor = "default"; const nc = tr.insertCell(); nc.className = "name"; nc.append(inkDots(e.o.colors), document.createTextNode(e.o.name)); if (e.oc) nc.append(el("small", null, e.oc));
      const w = numCell(tr, pct1(e.wr)); w.className += wrClass(e.wr); numCell(tr, "± " + f1(e.err * 100) + " p.p."); }); };
  const sorted = [...est].sort((a, b) => b.wr - a.wr);
  muTable("t-dlm-best", sorted.slice(0, 6)); muTable("t-dlm-worst", sorted.slice(-6).reverse());
  $("dlm-best-note").textContent = $("dlm-worst-note").textContent = `Mistura dos resultados reais dos decks mais parecidos com a fórmula da categoria do oponente. Como a sua lista divide ${Math.round(top.sc * 100)}% das cartas com o deck mais parecido, ${Math.round(alpha * 100)}% do peso vai para os resultados reais e ${Math.round((1 - alpha) * 100)}% para a fórmula. Decks do meta com pelo menos 2.000 partidas.`;
  }
  // 4. swap simulator (linear model: swapping 4 cards of function B for 4 of function A changes the estimate by 4 × (effect A − effect B))
  const cats = C.order.filter((c) => MM.models[c]), target = S.view.dlmCat, SW = 4;
  const counts = new Array(7).fill(0); items.forEach((x) => new Set((S.fn.byIdent[x.c.ident] || []).map(([hi]) => T.subs[T.habs[hi][0]][0])).forEach((f) => { if (f < 7) counts[f] += x.n; }));
  const swaps = [];
  for (let a = 0; a < 7; a++) for (let b = 0; b < 7; b++) { if (a === b || counts[b] < SW) continue;
    const d = {}; cats.forEach((c) => { d[c] = SW * (MM.models[c].fit.unit[a] - MM.models[c].fit.unit[b]); }); swaps.push({ a, b, d, label: `+${SW} ${FEAT_LABELS[a]} / −${SW} ${FEAT_LABELS[b]}` }); }
  { const d = {}; cats.forEach((c) => { d[c] = -0.5 * MM.models[c].fit.unit[8]; }); swaps.push({ curve: true, d, label: "Baixar a curva: −0,5 no custo médio dos personagens" }); }
  swaps.forEach((s2) => { s2.all = cats.reduce((a, c) => a + s2.d[c] * MM.presence[c], 0) / cats.reduce((a, c) => a + MM.presence[c], 0); });
  const best = swaps.filter((s2) => s2.d[target] > 0.001).sort((x, y) => y.d[target] - x.d[target]).slice(0, 8);
  $("dlm-sim-note").textContent = `Trocas de ${SW} cartas que mais melhoram a estimativa contra ${target} (troque a categoria acima). As colunas mostram o efeito em cada categoria e no win rate geral: uma troca que ajuda contra uma categoria pode piorar contra outra. Use como direção, não como número exato: cada estimativa tem a margem da tabela acima. Clique numa troca para ver cartas sugeridas.`;
  const ts = $("t-dlm-sim"); ts.replaceChildren(); const hs = ts.createTHead().insertRow(); ["Troca", ...cats.map((c) => "vs " + c), "Geral"].forEach((h, i) => hs.append(el("th", i ? "num" : "", h)));
  const bs = ts.createTBody();
  best.forEach((s2) => { const tr = bs.insertRow(); tr.tabIndex = 0; tr.onclick = () => { S.dlmSwap = s2.label; renderDeckAnalysis(); };
    if (S.dlmSwap === s2.label) tr.style.background = "var(--accent-wash)";
    tr.insertCell().textContent = s2.label; cats.forEach((c) => { const td = numCell(tr, pp(s2.d[c])); if (Math.abs(s2.d[c]) >= 0.001) td.className += s2.d[c] > 0 ? " up" : " down"; if (c === target) td.style.fontWeight = "700"; });
    const g = numCell(tr, pp(s2.all)); g.className += s2.all > 0 ? " up" : " down"; });
  if (!best.length) bs.insertRow().insertCell().textContent = "Nenhuma troca simples melhora a estimativa contra essa categoria.";
  // 5. card suggestions for the chosen swap
  const sw = best.find((s2) => s2.label === S.dlmSwap), sug = $("dlm-sug");
  if (!sw || sw.curve) { sug.hidden = !sw; if (sw) { $("dlm-sug-title").textContent = "Baixar a curva"; $("dlm-add-note").textContent = "Troque personagens de custo 5 ou mais por personagens de custo 2 ou 3 com funções parecidas."; $("t-dlm-add").replaceChildren(); $("dlm-cut-note").textContent = ""; $("t-dlm-cut").replaceChildren(); } return; }
  sug.hidden = false; $("dlm-sug-title").textContent = `Sugestões para: ${sw.label}`;
  const myInks = new Set(items.flatMap((x) => inkList(x.c))), have = new Set(items.map((x) => x.c.ident));
  const funcOf = (ident) => new Set((S.fn.byIdent[ident] || []).map(([hi]) => T.subs[T.habs[hi][0]][0]));
  const habsOf = (ident, f) => [...new Set((S.fn.byIdent[ident] || []).filter(([hi]) => T.subs[T.habs[hi][0]][0] === f).map(([hi]) => T.habs[hi][1]))].join(", ");
  const use = new Map(), nbUse = new Map();
  if (priv) { const GG = MM.decks.reduce((a, r) => a + r.d.games, 0); MM.decks.forEach((r) => Object.entries(byIdent(r.d.list)).forEach(([id, cp]) => use.set(id, (use.get(id) || 0) + cp * r.d.games / GG))); }
  else S.ins.popular.forEach((id, i) => use.set(id, 1 - i / S.ins.popular.length));  // public: popularity order only
  K.forEach((k) => Object.entries(listOf(k)).forEach(([id, cp]) => nbUse.set(id, (nbUse.get(id) || 0) + cp * k.w)));
  const useTxt = (u) => priv ? u.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : (u > 0.66 ? "alta" : u > 0.33 ? "média" : u > 0 ? "baixa" : "–");
  const pool = new Map(); S.cards.forEach((c) => { if (!c.core || have.has(c.ident) || !inkList(c).length || !inkList(c).every((i) => myInks.has(i)) || !funcOf(c.ident).has(sw.a)) return;
    const p = pool.get(c.ident); if (!p || (c.printing === "Normal" && p.printing !== "Normal")) pool.set(c.ident, c); });
  const cand = [...pool.values()].map((c) => ({ c, u: use.get(c.ident) || 0, nb: nbUse.get(c.ident) || 0 })).sort((x, y) => (y.nb * 3 + y.u) - (x.nb * 3 + x.u) || (x.c.price || 99) - (y.c.price || 99)).slice(0, 8);
  $("dlm-add-note").textContent = `Cartas de ${FEAT_LABELS[sw.a]} nas suas tintas, legais no Core e fora da sua lista, ordenadas pelo uso nos decks parecidos com o seu e no meta.`;
  const ta = $("t-dlm-add"); ta.replaceChildren(); const ha = ta.createTHead().insertRow(); ["Carta", "Custo", "Habilidade", priv ? "Cópias no meta" : "Popularidade no meta", "Preço"].forEach((h, i) => ha.append(el("th", [1, 3, 4].includes(i) ? "num" : "", h)));
  const ba = ta.createTBody(); cand.forEach((x) => { const tr = ba.insertRow(); tr.tabIndex = 0; tr.onclick = () => openDetail(x.c); nameCell(tr, x.c); numCell(tr, x.c.cost || "–");
    const hc2 = tr.insertCell(); hc2.className = "small"; hc2.textContent = habsOf(x.c.ident, sw.a); numCell(tr, useTxt(x.u)); numCell(tr, usd(x.c.price)); });
  const cut = items.filter((x) => funcOf(x.c.ident).has(sw.b)).map((x) => ({ x, nf: [...funcOf(x.c.ident)].filter((f) => f < 7).length, u: use.get(x.c.ident) || 0 })).sort((p, q) => p.nf - q.nf || p.u - q.u).slice(0, 6);
  $("dlm-cut-note").textContent = `Cartas de ${FEAT_LABELS[sw.b]} na sua lista que mais fazem só isso (menos funções) e são menos usadas no meta: candidatas a sair.`;
  const tcut = $("t-dlm-cut"); tcut.replaceChildren(); const hcu = tcut.createTHead().insertRow(); ["Cópias", "Carta", "Outras funções", priv ? "Cópias no meta" : "Popularidade no meta"].forEach((h, i) => hcu.append(el("th", [0, 3].includes(i) ? "num" : "", h)));
  const bcu = tcut.createTBody(); cut.forEach(({ x, u }) => { const tr = bcu.insertRow(); tr.tabIndex = 0; tr.onclick = () => openDetail(x.c); numCell(tr, x.n); nameCell(tr, x.c);
    const oc = tr.insertCell(); oc.className = "small"; oc.textContent = [...funcOf(x.c.ident)].filter((f) => f !== sw.b && f < 7).map((f) => T.funcs[f]).join(", ") || "—"; numCell(tr, useTxt(u)); });
  // 6. nearest decks
  $("dlm-note").textContent = priv ? `Decks do meta (${eraName}, Duels.ink) mais parecidos com a sua lista: 60% pelas cartas em comum, 40% pelas funções e curva. Eles alimentam a parte "resultados reais" dos confrontos por deck.`
    : `Decks de referência do meta (${eraName}) mais parecidos com a sua lista: 60% pelas cartas em comum, 40% pelas funções e curva. Veja as fichas na aba Meta.`;
  const tn = $("t-dlm-near"); tn.replaceChildren(); const hn = tn.createTHead().insertRow(); ["Deck", "Categoria", "Cartas em comum", "Funções parecidas"].forEach((h, i) => hn.append(el("th", i > 1 ? "num" : "", h)));
  const bn = tn.createTBody(); K.forEach((n) => { const tr = bn.insertRow(); tr.style.cursor = "default"; const nc = tr.insertCell(); nc.className = "name"; nc.append(inkDots(n.d.colors), document.createTextNode(n.d.name));
    catCell(tr, n.cat ? { cat: n.cat } : catOf(n.d.key, ek)); numCell(tr, Math.round(n.sc * 100) + "%"); numCell(tr, Math.round(n.sp * 100) + "%"); });
}

/* ---------- deck categories (Aggro / Tempo / Midrange / Controle) ---------- */
const CAT_DESC = {
  Aggro: "Curva muito baixa, quase só personagens; a maior parte das vitórias sai até o turno 7.",
  Tempo: "Curva baixa com interação barata (remoção cantada, Evasive, Bodyguard); fecha o jogo entre os turnos 7 e 9.",
  Midrange: "Muitos personagens de custo médio; ganha a disputa de mesa no meio do jogo, sem depender de wipe.",
  Controle: "Menos personagens, curva mais alta, wipe/remoção e compra; vitórias mais longas que as derrotas.",
};
function catOf(key, eraKey) {
  const C = S.duels && S.duels.decks.categories; if (!C) return null;
  const r = C.byKey[key]; if (r) return r;
  const c = (C.byEra[eraKey] || {})[key]; return c ? { cat: c } : null;
}
const catOrder = () => (S.duels && S.duels.decks.categories ? S.duels.decks.categories.order : S.ins ? S.ins.categories.order : []);
const catColor = (c) => { const i = catOrder().indexOf(c); return seriesColors()[i < 0 ? 5 : i]; };
const n1 = (v) => v == null ? "–" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
function catProfile(r) {
  const f = r && r.f; if (!f) return "";
  const parts = [`${n1(f.chars)} personagens por 60 cartas`, `custo médio dos personagens ${n1(f.avg_char_cost)}`, `${n1(f.cheap3)} personagens de custo ≤ 3`, `${n1(f.wipe)} cartas de wipe`, `${n1(f.removal)} de remoção`, `${n1(f.draw)} de compra`];
  if (f.win_len != null) parts.push(`vitórias em ${n1(f.win_len)} turnos e derrotas em ${n1(f.loss_len)}`, `${Math.round(f.win_by7 * 100)}% das vitórias até o turno 7`);
  return parts.join(" · ");
}
function catCell(tr, r) {
  const td = tr.insertCell();
  if (!r) { td.textContent = "–"; return td; }
  const dot = el("i"); dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px;background:${catColor(r.cat)}`;
  td.append(dot, document.createTextNode(r.cat));
  if (r.conf != null && r.conf < 0.25 && r.alt) td.append(el("small", null, ` perto de ${r.alt}`));
  td.title = `${r.cat}: ${CAT_DESC[r.cat] || ""}` + (r.f ? `\n\nEste deck${r.alt ? ` (2ª opção: ${r.alt}, confiança ${Math.round(r.conf * 100)}%)` : ""}: ${catProfile(r)}` : "");
  td.classList.add("tip");
  return td;
}
function catTotals(eraKey) {
  const e = deckEraData(eraKey), out = new Map(S.duels.decks.categories.order.map((c) => [c, { decks: 0, games: 0, wins: 0 }]));
  let classified = 0;
  e.decks.forEach((d) => { const r = catOf(d.key, eraKey); if (!r || !out.has(r.cat)) return; const o = out.get(r.cat); o.decks++; o.games += d.games; o.wins += d.wins; classified += d.games; });
  return { out, classified, total: 2 * e.totalGames };
}
function renderCategories(ek) {
  const C = S.duels.decks.categories; if (!C) return;
  const pk = prevEraKey(ek), cur = catTotals(ek), prev = pk ? catTotals(pk) : null, en = eraInfo(ek).name, pn = pk ? eraInfo(pk).name : null;
  const pp = (v) => v == null ? "–" : (v > 0 ? "+" : "") + (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " p.p.";
  $("cat-title").textContent = `Win rate por categoria (${en})`;
  $("cat-note").textContent = `Soma dos decks de cada categoria no ranqueado Core BO1 do Duels.ink. Presença = fração de todas as partidas; ${pct1(cur.classified / cur.total)} das partidas da ${en} têm deck classificado. Clique numa categoria para filtrá-la (é o mesmo filtro Categoria do topo).`;
  const t = $("t-cat"); t.replaceChildren();
  const hr = t.createTHead().insertRow();
  ["Categoria", "Decks", "Partidas", "Presença"].concat(pk ? [`Δ vs ${pn}`] : []).concat(["Win rate"]).concat(pk ? [`Δ vs ${pn}`] : []).forEach((h, i) => hr.append(el("th", i ? "num" : "", h)));
  const b = t.createTBody();
  C.order.forEach((c) => {
    const o = cur.out.get(c), q = prev && prev.out.get(c);
    const play = o.games / cur.total, wr = o.games ? o.wins / o.games : null;
    const tr = b.insertRow(); tr.tabIndex = 0; tr.title = CAT_DESC[c];
    if (S.filter.cats.has(c)) tr.style.background = "var(--accent-wash)";
    tr.onclick = tr.onkeydown = (e) => { if (e.type !== "click" && e.key !== "Enter") return; const fc = S.filter.cats; fc.has(c) && fc.size === 1 ? fc.clear() : (fc.clear(), fc.add(c)); changed(); };
    catCell(tr, { cat: c });
    numCell(tr, o.decks); numCell(tr, Math.round(o.games / 2).toLocaleString("pt-BR")); numCell(tr, pct1(play));
    if (pk) { const v = q && q.games ? play - q.games / prev.total : null; const td = numCell(tr, pp(v)); if (v) td.className += v > 0 ? " up" : " down"; }
    const w = numCell(tr, pct1(wr)); w.className += wrClass(wr);
    if (pk) { const v = q && q.games && wr != null ? wr - q.wins / q.games : null; const td = numCell(tr, pp(v)); if (v) td.className += v > 0 ? " up" : " down"; }
  });
  $("cat-method").textContent = "Nenhuma regra isolada decide. Cada deck é comparado com decks de referência de cada categoria (Aggro: Princess, Rockstar e Amber/Amethyst Aggro; Tempo: Emerald/Steel Midrange e Touch Paradise; Midrange: Amethyst/Steel e Amber/Amethyst Midrange; Controle: Candle Control, Ruby R.E.D. e Retro Device) em várias medidas ao mesmo tempo: fração das vitórias até o turno 7, duração das vitórias, diferença entre a duração das vitórias e das derrotas, personagens por 60 cartas, personagens de custo ≤ 3, custo médio dos personagens, wipes, remoção e compra. Ganha a categoria mais parecida; o nome do arquétipo no Duels.ink pesa um pouco. Quando a segunda opção fica perto, a tabela mostra \"perto de…\". Passe o mouse na categoria de um deck para ver o perfil dele. Cada deck nomeado tem uma categoria só (a da expansão mais recente com dados suficientes); decks \"Outros\" são classificados em cada expansão.";
  // matchup matrix between categories
  const e = deckEraData(ek), M = new Map();
  (e.matchups || []).forEach(([i, j, g, w]) => { if (i === j) return; const a = catOf(e.decks[i].key, ek), bb = catOf(e.decks[j].key, ek); if (!a || !bb) return;
    const k = a.cat + "|" + bb.cat, m = M.get(k) || [0, 0]; m[0] += g; m[1] += w; M.set(k, m); });
  $("catmu-title").textContent = `Confrontos entre categorias (${en})`;
  const mt = $("t-catmu"); mt.replaceChildren();
  if (!M.size) { $("catmu-note").textContent = "O Duels.ink não tem confrontos por deck nesta expansão."; return; }
  $("catmu-note").textContent = "Win rate da categoria da linha contra a da coluna (soma dos confrontos entre decks; espelhos de categoria ficam de fora).";
  const mh = mt.createTHead().insertRow(); mh.append(el("th", "", ""));
  C.order.forEach((c) => mh.append(el("th", "num", "vs " + c)));
  const mb = mt.createTBody();
  C.order.forEach((a) => { const tr = mb.insertRow(); tr.style.cursor = "default"; catCell(tr, { cat: a });
    C.order.forEach((bb) => { if (a === bb) { numCell(tr, "—"); return; } const m = M.get(a + "|" + bb);
      const td = numCell(tr, m && m[0] ? pct1(m[1] / m[0]) : "–"); if (m && m[0]) { td.className += wrClass(m[1] / m[0]); td.title = `${m[0].toLocaleString("pt-BR")} partidas`; } }); });
  renderCatEvolution();
}
const CAT_MIN = 2000; // player-games: below this a category's win rate is too noisy to plot
function renderCatEvolution() {
  const C = S.duels.decks.categories, gran = S.view.catGran, col = (c) => catColor(c);
  const r1 = (v) => v == null ? null : Math.round(v * 1000) / 10, pctF = (v) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
  let labels, wr, play, eraLabels = null;
  if (gran === "era" || !S.duels.weekly) {
    const order = eraOrder(); labels = order.map((k) => eraInfo(k).start); eraLabels = order.map((k) => eraInfo(k).name);
    const T = order.map(catTotals);
    wr = (c) => T.map((t) => { const o = t.out.get(c); return o.games >= CAT_MIN ? r1(o.wins / o.games) : null; });
    play = (c) => T.map((t) => r1(t.out.get(c).games / t.total));
    $("catevo-note").textContent = "Uma medição por expansão do ranqueado Core BO1 (Set 11 a Set 14). Decks nomeados mantêm a categoria atual em todas as expansões; decks \"Outros\" usam a lista de cada expansão.";
  } else {
    const eras = S.duels.eras, eraAt = (wk) => { let k = eras[0].key; eras.forEach((e) => { if (e.start <= addDays(wk, 3)) k = e.key; }); return k; };
    const weeks = S.duels.weekly; labels = weeks.map((w) => w.week);
    const T = weeks.map((w) => { const ek = eraAt(w.week), out = new Map(C.order.map((c) => [c, [0, 0]]));
      Object.entries(w.decks).forEach(([k, [g, won]]) => { const r = catOf(k, ek); if (r && out.has(r.cat)) { out.get(r.cat)[0] += g; out.get(r.cat)[1] += won; } });
      return { out, total: w.profGames || 2 * w.games }; });
    wr = (c) => T.map((t) => { const [g, w] = t.out.get(c); return g >= CAT_MIN ? r1(w / g) : null; });
    play = (c) => T.map((t) => r1(t.out.get(c)[0] / t.total));
    $("catevo-note").textContent = "Semanas do ranqueado Core BO1 desde a rotação (12/07/2026); a presença semanal é a fração dos decks com arquétipo identificado. A primeira e a última semana podem estar incompletas. Linhas tracejadas: lançamentos; vermelhas: rotações.";
  }
  $("catevo-note").textContent += " Win rate só aparece quando a categoria tem pelo menos 1.000 partidas no período.";
  multiLineChart("c-cat-wr", labels, C.order.map((c) => ({ name: c, color: col(c), values: wr(c) })), pctF, eraLabels, gran === "week");
  multiLineChart("c-cat-play", labels, C.order.map((c) => ({ name: c, color: col(c), values: play(c) })), pctF, eraLabels, gran === "week");
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

/* ---------- Mechanics tab ---------- */
const SERIES = { light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"], dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"] };
const seriesColors = () => SERIES[matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"];

function windowRange() {
  const f = S.filter;
  if (f.window === "custom") return [f.from, f.to];
  if (f.window === "all") return [null, S.latest];
  const n = { d1: 1, d7: 7, d30: 30, d90: 90, d365: 365 }[f.window] || 30;
  return [addDays(S.latest, -n), S.latest];
}

let mechToken = 0;
async function renderMechs() {
  if (!S.duels || !S.duels.weekly) return;
  syncView();
  const my = ++mechToken, f = S.filter, gran = S.view.mechGran, mechs = S.duels.mechanics;
  // cards in scope: all filters except the mechanic filter (it only picks which lines to draw)
  const rows = S.cards.filter((c) => passes(c, true));
  const { groups, member, noun } = mechGroups();
  const level = S.view.mechLevel;
  $("mom-filter-wrap").hidden = level === "duels" || !S.duels.taxonomy;
  const setOf = groups.map(() => new Set()), cardsOf = groups.map(() => []);
  rows.forEach((c) => { const d = duelsOf(c); if (!d) return; new Set(member(d)).forEach((g) => { setOf[g].add(d.id); cardsOf[g].push(c); }); });
  if (S.mechOpen != null && !groups[S.mechOpen]) S.mechOpen = null;
  const [from, to] = windowRange();
  // ---- participation: share of opening-hand card appearances that have the mechanic ----
  let labels, shareAt, cardShare;
  if (gran === "week") {
    const weeks = S.duels.weekly.filter((w) => (!from || addDays(w.week, 6) >= from) && (!to || w.week <= to));
    labels = weeks.map((w) => w.week);
    const tots = weeks.map((w) => Object.values(w.cards).reduce((a, v) => a + v[0], 0));
    cardShare = (cid) => weeks.map((w, i) => tots[i] ? ((w.cards[cid] || [0])[0]) / tots[i] * 100 : null);
    shareAt = (m) => weeks.map((w) => { let tot = 0, num = 0; for (const [cid, v] of Object.entries(w.cards)) { tot += v[0]; if (setOf[m].has(cid)) num += v[0]; } return tot ? num / tot * 100 : null; });
  } else {
    const eras = S.duels.eras;
    labels = eras.map((e) => e.start);
    const tots = eras.map((e, i) => S.duels.cards.reduce((a, d) => a + (d.u[i] ? d.u[i][0] : 0), 0));
    cardShare = (cid) => { const d = S.duelsById.get(cid); return eras.map((e, i) => tots[i] ? (d && d.u[i] ? d.u[i][0] : 0) / tots[i] * 100 : null); };
    shareAt = (m) => eras.map((e, i) => { let tot = 0, num = 0; S.duels.cards.forEach((d) => { const u = d.u[i]; if (!u) return; tot += u[0]; if (setOf[m].has(d.id)) num += u[0]; }); return tot ? num / tot * 100 : null; });
  }
  const allShares = groups.map((_, m) => shareAt(m));
  const lastOf = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i]; return null; };
  const firstOf = (arr) => arr.find((v) => v != null) ?? null;
  const lines = S.mechLines[level] || (S.mechLines[level] = new Set());
  let chosen = [...lines].filter((g) => groups[g] && setOf[g].size);
  if (!chosen.length) chosen = groups.map((_, m) => m).filter((m) => setOf[m].size && !groups[m].skip).sort((a, b) => (lastOf(allShares[b]) || 0) - (lastOf(allShares[a]) || 0)).slice(0, 5);
  chosen = chosen.slice(0, 6);
  const col = seriesColors();
  const r1 = (v) => v == null ? null : Math.round(v * 100) / 100;
  const pctF = (v) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
  $("mech-note").textContent = (gran === "week"
    ? `Semanas do ranqueado Core BO1 do Duels.ink desde a rotação (12/07/2026), recortadas pela janela do filtro (${windowText()}). A primeira e a última semana podem estar incompletas.`
    : "Uma medição por expansão (Set 11 a Set 14), sem recorte de janela.")
    + ` Participação = % das cartas vistas nas mãos iniciais que têm ${noun} (todas as partidas; os filtros de tinta, raridade, formato etc. definem quais cartas contam).${S.momSel.size && level !== "duels" ? " Só habilidades nos momentos escolhidos." : ""} ${lines.size ? "" : "Mostrando as 5 com maior participação atual; marque outras na tabela abaixo (até 6)."}`;
  $("mech-price-title").textContent = "Preço das cartas por " + ({ func: "função", sub: "subfunção", hab: "habilidade", mom: "momento", duels: "mechanic" })[level];
  multiLineChart("c-mech-share", labels, chosen.map((m, i) => ({ name: groups[m].label, color: col[i], values: allShares[m].map(r1) })), pctF, gran === "era" ? S.duels.eras.map((e) => e.name) : null);

  // ---- price index per mechanic (100 = start of the period) ----
  const gids = [...new Set(rows.filter((c) => duelsOf(c)).map((c) => c.set))];
  if (!gids.every((g) => histNow(g))) { $("mech-price-note").textContent = "Carregando histórico de preços…"; await loadHistories(gids); if (my !== mechToken) return; }
  const h0 = histNow(gids[0]);
  let pdates;
  if (gran === "week") { const start = from || labels[0] || h0.dates[0]; pdates = h0.dates.filter((d) => d >= start && (!to || d <= to)); }
  else pdates = S.duels.eras.map((e) => e.start).concat([S.latest]);
  const tdays = pdates.map(day);
  const idxMap = h0.days ? tdays.map((t) => { let i = h0.days.length - 1; while (i >= 0 && h0.days[i] > t) i--; return i; }) : [];
  const valAt = (arr, k) => { const i = idxMap[k]; for (let j = i; j >= 0 && tdays[k] - h0.days[j] <= CARRY_DAYS; j--) if (arr[j]) return arr[j]; return null; };
  const indexOf = (m) => {
    const base = new Map();
    cardsOf[m].forEach((c) => { const h = histNow(c.set), arr = h && h.s[c.id]; if (!arr) return; const b = valAt(arr, 0); if (b) base.set(c, arr); });
    return pdates.map((_, k) => { let num = 0, den = 0; base.forEach((arr, c) => { const v = valAt(arr, k); if (v) { num += v; den += valAt(arr, 0); } }); return den ? num / den * 100 : null; });
  };
  const allIdx = new Map(); const idx = (m) => { if (!allIdx.has(m)) allIdx.set(m, indexOf(m)); return allIdx.get(m); };
  $("mech-price-note").textContent = `Índice de preço (100 = ${fmtDate(pdates[0])}): soma dos preços atuais ÷ soma dos preços no início, só com as cartas que tinham preço nas duas datas. Respeita os filtros de carta (tinta, raridade, impressão, formato…).`;
  multiLineChart("c-mech-price", pdates, chosen.map((m, i) => ({ name: groups[m].label, color: col[i], values: idx(m).map(r1) })), (v) => Number(v).toLocaleString("pt-BR"), gran === "era" ? S.duels.eras.map((e) => e.name).concat(["Hoje"]) : null);

  // ---- summary table (all mechanics) ----
  const rowsT = groups.map((mm, m) => { const sh = allShares[m], ix = idx(m), s0 = firstOf(sh), s1 = lastOf(sh), i1 = lastOf(ix);
    return { m, name: mm.label, desc: mm.desc, group: mm.parent || "", n: setOf[m].size, s0, s1, dShare: s0 != null && s1 != null ? s1 - s0 : null, px: i1 != null ? i1 - 100 : null }; }).filter((r) => r.n);
  if (S.mechOpen != null && setOf[S.mechOpen]) { renderMechCards(groups[S.mechOpen], cardsOf[S.mechOpen], cardShare, valAt, pdates, firstOf, lastOf, pctF, (d) => member(d, true).filter((x) => x[0] === S.mechOpen).map((x) => x[1])); return; }
  $("mech-back").hidden = true; $("mc-pager").hidden = true; $("mech-sum-title").textContent = "Resumo do período";
  $("mech-sum-note").textContent = "Clique numa linha para ver as cartas. Marque a caixa da primeira coluna para escolher as linhas dos gráficos (até 6).";
  const { key, dir } = S.mechSort;
  rowsT.sort((a, b) => { const x = a[key], y = b[key]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * dir; });
  const tbl = $("t-mech"); tbl.replaceChildren();
  const hr = tbl.createTHead().insertRow();
  [["line", "Gráfico"], ["name", ({ func: "Função", sub: "Subfunção", hab: "Habilidade", mom: "Momento", duels: "Mechanic" })[level]], ["group", level === "func" || level === "mom" ? "" : "Dentro de"], ["n", "Cartas"], ["s0", "Participação no início"], ["s1", "Participação no fim"], ["dShare", "Δ participação"], ["px", "Variação de preço"]].forEach(([k, l]) => {
    const th = el("th", ["name", "group", "line"].includes(k) ? "" : "num", l); if (k === "line") { hr.append(th); return; } th.tabIndex = 0; if (key === k) th.setAttribute("aria-sort", dir < 0 ? "descending" : "ascending");
    th.onclick = () => { S.mechSort = { key: k, dir: S.mechSort.key === k ? -S.mechSort.dir : (["name", "group"].includes(k) ? 1 : -1) }; renderMechs(); }; hr.append(th); });
  const b = tbl.createTBody();
  rowsT.forEach((r) => { const tr = b.insertRow(); tr.tabIndex = 0;
    const ci = chosen.indexOf(r.m); if (ci >= 0) tr.style.boxShadow = `inset 4px 0 0 ${col[ci]}`;
    tr.onclick = tr.onkeydown = (e) => { if (e.type !== "click" && e.key !== "Enter") return; S.mechOpen = r.m; S.mcPage = 0; renderMechs(); $("t-mech").closest("article").scrollIntoView({ behavior: "smooth", block: "start" }); };
    const lc = tr.insertCell(), cb = el("input"); cb.type = "checkbox"; cb.checked = ci >= 0; cb.title = "Mostrar nos gráficos";
    cb.onclick = (e) => { e.stopPropagation(); if (!lines.size) chosen.forEach((g) => lines.add(g)); lines.has(r.m) ? lines.delete(r.m) : lines.size < 6 && lines.add(r.m); renderMechs(); };
    lc.append(cb);
    const nmc = tr.insertCell(); nmc.textContent = r.name; if (r.desc) { nmc.title = r.desc; nmc.className = "tip"; }
    tr.insertCell().textContent = r.group;
    numCell(tr, r.n.toLocaleString("pt-BR")); numCell(tr, r.s0 == null ? "–" : pctF(r.s0)); numCell(tr, r.s1 == null ? "–" : pctF(r.s1));
    const d = numCell(tr, r.dShare == null ? "–" : (r.dShare > 0 ? "+" : "") + r.dShare.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " p.p."); if (r.dShare) d.className += r.dShare > 0 ? " up" : " down";
    const p = numCell(tr, pctTxt(r.px == null ? null : Math.round(r.px * 10) / 10)); if (r.px) p.className += r.px > 0 ? " up" : " down"; });
}

/** Groups for the Mechanics tab at the chosen level. member(d) -> group indices; member(d, true) -> [group, "habilidade · momento"]. */
function mechGroups() {
  const level = S.view.mechLevel, T = S.duels.taxonomy;
  if (level === "duels" || !T) {
    const groups = S.duels.mechanics.map((m) => ({ label: m.label, parent: m.group, skip: m.key === "no_text" }));
    return { groups, noun: "a mechanic", member: (d, det) => det ? d.m.map((i) => [i, S.duels.mechanics[i].label]) : d.m };
  }
  const func = (hi) => T.subs[T.habs[hi][0]][0];
  const habLabel = (hi) => T.habs[hi][1], momLabel = (mi) => T.moments[mi];
  const keyOf = { func: (hi, mi) => func(hi), sub: (hi) => T.habs[hi][0], hab: (hi) => hi, mom: (hi, mi) => mi }[level];
  const D = T.desc || {};
  const groups = level === "func" ? T.funcs.map((f, i) => ({ label: f, skip: f === "Outros" || f === "Corpo", desc: D.funcs?.[i] }))
    : level === "sub" ? T.subs.map(([fi, l], i) => ({ label: l, parent: T.funcs[fi], skip: fi >= 7, desc: D.subs?.[i] }))
    : level === "hab" ? T.habs.map(([si, l], i) => ({ label: l, parent: `${T.funcs[T.subs[si][0]]} › ${T.subs[si][1]}`, skip: T.subs[si][0] >= 7, desc: D.habs?.[i] }))
    : T.moments.map((m, i) => ({ label: m, skip: m === "—" || m === "Contínuo", desc: D.moments?.[i] }));
  const ok = (mi) => !S.momSel.size || S.momSel.has(String(mi));
  return { groups, noun: { func: "a função", sub: "a subfunção", hab: "a habilidade", mom: "uma habilidade nesse momento" }[level],
    member: (d, det) => (d.fx || []).filter(([hi, mi]) => ok(mi)).map(([hi, mi]) => det ? [keyOf(hi, mi), `${habLabel(hi)} · ${momLabel(mi)}`] : keyOf(hi, mi)) };
}

/** Card list of one mechanic, same period as the summary: per-card participation and price change. */
function renderMechCards(mech, cards, cardShare, valAt, pdates, firstOf, lastOf, pctF, detailOf) {
  $("mech-back").hidden = false;
  $("mech-back").onclick = () => { S.mechOpen = null; renderMechs(); };
  $("mech-sum-title").textContent = `Cartas: ${mech.label}`;
  // one row per Duels.ink card, priced by its Normal printing (or the cheapest)
  const byCard = new Map();
  cards.forEach((c) => { const d = duelsOf(c); const have = byCard.get(d.id);
    if (!have || (c.printing === "Normal" && have.printing !== "Normal") || (have.printing !== "Normal" && c.price < have.price)) byCard.set(d.id, c); });
  const last = pdates.length - 1;
  const rows = [...byCard].map(([cid, c]) => {
    const sh = cardShare(cid), s0 = firstOf(sh), s1 = lastOf(sh), h = histNow(c.set), arr = h && h.s[c.id];
    const p0 = arr ? valAt(arr, 0) : null, p1 = arr ? valAt(arr, last) : null;
    return { c, s0, s1, dShare: s0 != null && s1 != null ? s1 - s0 : null, price: c.price, px: p0 && p1 ? Math.round((p1 / p0 - 1) * 1000) / 10 : null, det: detailOf ? [...new Set(detailOf(S.duelsById.get(cid)))].join(" · ") : "" };
  }).filter((r) => (r.s0 || 0) + (r.s1 || 0) > 0 || r.price);
  const used = rows.filter((r) => r.s1 > 0).length;
  $("mech-sum-note").textContent = `${rows.length} cartas em "${mech.label}" (${used} aparecendo nas mãos iniciais no fim do período), respeitando os filtros de carta. Participação = % das cartas vistas nas mãos iniciais que são esta carta. Variação de preço no mesmo período do índice (desde ${fmtDate(pdates[0])}), pela impressão normal. Clique numa carta para ver o histórico.`;
  const { key, dir } = S.mcSort;
  const val = (r, k) => k === "name" ? r.c.name : r[k];
  rows.sort((a, b) => { const x = val(a, key), y = val(b, key); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * dir; });
  const tbl = $("t-mech"); tbl.replaceChildren();
  const hr = tbl.createTHead().insertRow();
  [["img", ""], ["name", "Carta"], ["det", "Habilidade · momento"], ["s0", "Participação no início"], ["s1", "Participação no fim"], ["dShare", "Δ participação"], ["price", "Preço"], ["px", "Variação de preço"]].forEach(([k, l]) => {
    const th = el("th", ["img", "name", "det"].includes(k) ? "" : "num", l);
    if (k !== "img") { th.tabIndex = 0; if (key === k) th.setAttribute("aria-sort", dir < 0 ? "descending" : "ascending");
      th.onclick = () => { S.mcSort = { key: k, dir: S.mcSort.key === k ? -S.mcSort.dir : (k === "name" ? 1 : -1) }; S.mcPage = 0; renderMechs(); }; }
    hr.append(th); });
  const f2 = (v) => v == null ? "–" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); S.mcPage = Math.min(S.mcPage, pages - 1);
  $("mc-pager").hidden = pages < 2; $("mc-info").textContent = `${S.mcPage + 1} / ${pages}`;
  $("mc-prev").onclick = () => { S.mcPage = Math.max(0, S.mcPage - 1); renderMechs(); };
  $("mc-next").onclick = () => { S.mcPage = Math.min(pages - 1, S.mcPage + 1); renderMechs(); };
  const b = tbl.createTBody();
  rows.slice(S.mcPage * PAGE, S.mcPage * PAGE + PAGE).forEach((r) => { const tr = b.insertRow(); tr.tabIndex = 0;
    tr.onclick = tr.onkeydown = (e) => { if (e.type === "click" || e.key === "Enter") openDetail(r.c); };
    imgCell(tr, r.c); nameCell(tr, r.c); const dc = tr.insertCell(); dc.textContent = r.det || "–"; dc.className = "small";
    numCell(tr, f2(r.s0)); numCell(tr, f2(r.s1));
    const d = numCell(tr, r.dShare == null ? "–" : (r.dShare > 0 ? "+" : "") + r.dShare.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " p.p."); if (r.dShare) d.className += r.dShare > 0 ? " up" : " down";
    numCell(tr, usd(r.price));
    const p = numCell(tr, pctTxt(r.px)); if (r.px) p.className += r.px > 0 ? " up" : " down"; });
}

function multiLineChart(id, labels, series, yfmt, eraLabels, weekly = S.view.mechGran === "week") {
  const o = baseOpts();
  const ts = (d) => Date.parse(d + "T12:00:00Z");
  const xs = labels.map(ts);
  o.layout = { padding: { top: 18 } };
  o.interaction = { mode: "index", intersect: false };
  o.plugins.legend = { display: true, position: "top", align: "start", labels: { boxWidth: 14, boxHeight: 2, color: css("--text-secondary") } };
  o.plugins.tooltip.displayColors = true;
  o.plugins.tooltip.callbacks = {
    title: (it) => eraLabels ? eraLabels[it[0].dataIndex] + " (" + fmtDate(labels[it[0].dataIndex]) + ")" : (weekly && labels.length < 40 ? "semana de " : "") + fmtDate(labels[it[0].dataIndex]),
    label: (ctx) => `${ctx.dataset.label}: ${yfmt(ctx.parsed.y)}`,
  };
  const pad = eraLabels ? 20 * 864e5 : 0;
  o.scales.x = { type: "linear", min: xs[0] - pad, max: xs[xs.length - 1] + pad, grid: { display: false }, border: { display: false },
    ticks: { maxTicksLimit: 8, maxRotation: 0, callback: (v) => { const d = new Date(v); return String(d.getUTCDate()).padStart(2, "0") + "/" + String(d.getUTCMonth() + 1).padStart(2, "0"); } } };
  o.scales.y.ticks = { callback: (v) => yfmt(v) }; o.scales.y.grace = "8%";
  o.plugins.evlines = { items: eventItems() };
  const ds = series.map((s) => ({ label: s.name, data: s.values.map((y, i) => ({ x: xs[i], y })), parsing: false, borderColor: s.color, backgroundColor: s.color,
    borderWidth: 2, pointRadius: xs.length < 30 ? 3 : 0, pointHoverRadius: 5, pointBorderColor: css("--surface-1"), pointBorderWidth: 2, spanGaps: true, tension: 0 }));
  upsert(id, { type: "line", data: { datasets: ds }, options: o, plugins: [crosshair, evlines] });
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
function barChart(id, labels, datasets, { horizontal = false, log = false, stacked = false, legend = false, tooltip, fmt, onClick, labelMax = 24 }) {
  const o = baseOpts(), vAxis = horizontal ? "x" : "y", cAxis = horizontal ? "y" : "x";
  o.indexAxis = horizontal ? "y" : "x";
  o.scales[cAxis].grid.display = false;
  o.scales[cAxis].stacked = stacked; o.scales[vAxis].stacked = stacked;
  if (horizontal) o.scales[cAxis].ticks = { autoSkip: false, callback: (v) => { const l = labels[v] || ""; return l.length > labelMax ? l.slice(0, labelMax - 2) + "…" : l; } };
  o.scales[vAxis].type = log ? "logarithmic" : "linear";
  o.scales[vAxis].ticks = { callback: (v) => (log && ![0.1, 1, 10, 100, 1000, 10000, 100000].includes(v)) ? "" : fmt ? fmt(v) : "$" + Number(v).toLocaleString("pt-BR") };
  if (log) o.scales[vAxis].title = { display: true, text: "escala logarítmica" };
  o.plugins.tooltip.callbacks = { title: (it) => labels[it[0].dataIndex], label: (ctx) => tooltip(ctx.dataIndex, ctx.datasetIndex) };
  if (onClick) {
    o.interaction = { mode: "index", axis: horizontal ? "y" : "x", intersect: false }; // the whole row/column is clickable, not only the bar
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

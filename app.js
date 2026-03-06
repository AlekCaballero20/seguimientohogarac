/* Hogares | Musicala
   PWA + LocalStorage CRUD + filtros + export/import + recurrentes
   + Stats globales + filtros avanzados + CSV + vista compacta/detallada
   Mantiene LS_KEY y estructura base para no romper instalaciones existentes.
*/

"use strict";

const LS_KEY = "hogares_pwa_v1";
const UI_KEY = "hogares_pwa_ui_v1";

const DEFAULT_PLACES = [
  { id: "musicala", name: "Musicala" },
  { id: "nuestro", name: "Nuestro espacio (Alek y Cata)" },
  { id: "casa_alek", name: "Casa Alek" },
  { id: "casa_cata", name: "Casa Cata" }
];

const DEFAULT_CATEGORIES = [
  "General",
  "Baño",
  "Cocina",
  "Sala",
  "Cuartos",
  "Estudio",
  "Mascotas",
  "Herramientas",
  "Electrodomésticos",
  "Limpieza",
  "Musicala: Salones",
  "Musicala: Recepción",
  "Musicala: Baños",
  "Musicala: Bodega"
];

/* =========================
   Helpers
========================= */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function nowISO() {
  return new Date().toISOString();
}

function todayYMD() {
  return new Date().toISOString().slice(0, 10);
}

function uid() {
  return "t_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

function clampInt(n, min, max, fallback) {
  const x = Number.parseInt(n, 10);
  if (Number.isNaN(x)) return fallback;
  return Math.max(min, Math.min(max, x));
}

function safeJSONParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("es-CO", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}

function formatCOP(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return "$0";
  return num.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  });
}

function formatPercent(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "0%";
  return `${Math.round(num)}%`;
}

function addDays(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function slugId(name) {
  const base = String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return base || ("id_" + Math.random().toString(16).slice(2));
}

function debounce(fn, wait = 120) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[m]));
}

function sanitizeCost(v) {
  if (v === null || v === undefined || v === "") return "";
  const cleaned = String(v).replace(/[^\d]/g, "");
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num <= 0) return "";
  return num;
}

function parseCost(v) {
  const num = Number(v);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function normalizeRecurring(r) {
  const enabled = !!(r && r.enabled);
  const everyDays = clampInt(r?.everyDays, 1, 365, 30);
  return { enabled, everyDays };
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "es", { sensitivity: "base" });
}

function isOverdue(task) {
  if (!task || task.status === "done" || !task.dueDate) return false;
  return task.dueDate < todayYMD();
}

function isDueSoon(task, days = 7) {
  if (!task || task.status === "done" || !task.dueDate) return false;
  const today = todayYMD();
  const future = addDays(today, days);
  return task.dueDate >= today && task.dueDate <= future;
}

function typeLabel(t) {
  return ({ reparar: "Arreglar", comprar: "Comprar", reponer: "Reponer", mejorar: "Mejorar" }[t] || t || "Tipo");
}

function statusLabel(s) {
  return ({ todo: "Pendiente", doing: "En proceso", done: "Hecho" }[s] || s || "Estado");
}

function priorityLabel(p) {
  return ({ 3: "Alta", 2: "Media", 1: "Baja" }[Number(p)] || "Media");
}

function nextStatus(current) {
  if (current === "todo") return "doing";
  if (current === "doing") return "done";
  return "todo";
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n;]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/* =========================
   UI state
========================= */
function loadUIState() {
  const raw = localStorage.getItem(UI_KEY);
  const ui = safeJSONParse(raw, {});
  return {
    viewMode: ui?.viewMode === "compact" ? "compact" : "detailed"
  };
}

function saveUIState() {
  localStorage.setItem(UI_KEY, JSON.stringify(uiState));
}

let uiState = loadUIState();

/* =========================
   State load/save + migration
========================= */
function makeInitState() {
  return {
    version: 1,
    places: DEFAULT_PLACES.map((p) => ({ ...p })),
    categories: DEFAULT_CATEGORIES.slice(),
    tasks: []
  };
}

function normalizeState(st) {
  const init = makeInitState();
  const out = (st && typeof st === "object") ? st : init;

  if (!Array.isArray(out.places) || out.places.length === 0) out.places = init.places;
  if (!Array.isArray(out.categories) || out.categories.length === 0) out.categories = init.categories;
  if (!Array.isArray(out.tasks)) out.tasks = [];

  out.places = out.places
    .filter((p) => p && typeof p === "object" && p.id && p.name)
    .map((p) => ({ id: String(p.id), name: String(p.name) }));

  if (out.places.length === 0) out.places = init.places;

  const placeIds = new Set(out.places.map((p) => p.id));

  const seen = new Set();
  out.categories = out.categories
    .map((c) => String(c || "").trim())
    .filter((c) => c)
    .filter((c) => (seen.has(c) ? false : (seen.add(c), true)));

  if (out.categories.length === 0) out.categories = init.categories;

  out.tasks = out.tasks
    .filter((t) => t && typeof t === "object")
    .map((t) => {
      const placeId = String(t.placeId || out.places[0]?.id || "musicala");
      return {
        id: String(t.id || uid()),
        title: String(t.title || "").trim(),
        notes: String(t.notes || ""),
        placeId: placeIds.has(placeId) ? placeId : (out.places[0]?.id || "musicala"),
        type: t.type || "reponer",
        category: String(t.category || "General"),
        priority: clampInt(t.priority, 1, 3, 2),
        status: t.status || "todo",
        dueDate: t.dueDate || "",
        cost: sanitizeCost(t.cost),
        recurring: normalizeRecurring(t.recurring),
        createdAt: t.createdAt || nowISO(),
        updatedAt: t.updatedAt || t.createdAt || nowISO()
      };
    });

  out.version = 1;
  return out;
}

function loadState() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) {
    const init = makeInitState();
    localStorage.setItem(LS_KEY, JSON.stringify(init));
    return init;
  }
  const parsed = safeJSONParse(raw, null);
  const normalized = normalizeState(parsed);
  localStorage.setItem(LS_KEY, JSON.stringify(normalized));
  return normalized;
}

function saveState(st) {
  localStorage.setItem(LS_KEY, JSON.stringify(st));
}

let state = loadState();

/* =========================
   UI refs
========================= */
const placeSelect = $("#placeSelect");
const statusFilter = $("#statusFilter");
const typeFilter = $("#typeFilter");
const priorityFilter = $("#priorityFilter");
const categoryFilter = $("#categoryFilter");
const sortBy = $("#sortBy");
const onlyOverdue = $("#onlyOverdue");
const onlyRecurring = $("#onlyRecurring");
const q = $("#q");
const btnClearFilters = $("#btnClearFilters");

const list = $("#list");
const empty = $("#empty");
const resultsCount = $("#resultsCount");
const listHint = $("#listHint");

const statTotal = $("#statTotal");
const statTodo = $("#statTodo");
const statDoing = $("#statDoing");
const statDone = $("#statDone");
const statOverdue = $("#statOverdue");
const statRecurring = $("#statRecurring");
const statCost = $("#statCost");
const statCompletion = $("#statCompletion");

const summaryContext = $("#summaryContext");
const insightHealth = $("#insightHealth");
const insightPlace = $("#insightPlace");
const insightCategory = $("#insightCategory");
const insightFocus = $("#insightFocus");

const btnNew = $("#btnNew");
const btnExport = $("#btnExport");
const btnExportCsv = $("#btnExportCsv");
const importFile = $("#importFile");
const btnSeed = $("#btnSeed");
const btnStats = $("#btnStats");
const btnSettings = $("#btnSettings");
const moreMenu = $("#moreMenu");

const viewDetailed = $("#viewDetailed");
const viewCompact = $("#viewCompact");
const btnExpandAll = $("#btnExpandAll");
const btnCollapseAll = $("#btnCollapseAll");

const modal = $("#taskModal");
const form = $("#taskForm");
const modalTitle = $("#modalTitle");
const btnClose = $("#btnClose");
const btnCancel = $("#btnCancel");
const btnDelete = $("#btnDelete");

const taskId = $("#taskId");
const titleIn = $("#title");
const notesIn = $("#notes");
const placeIn = $("#place");
const typeIn = $("#type");
const categoryIn = $("#category");
const priorityIn = $("#priority");
const statusIn = $("#status");
const dueDateIn = $("#dueDate");
const costIn = $("#cost");
const recurringIn = $("#recurring");
const everyDaysIn = $("#everyDays");
const nextHintIn = $("#nextHint");

/* =========================
   Selects
========================= */
function fillPlacesSelect(selectEl, { includeAll = false } = {}) {
  if (!selectEl) return;
  const prev = selectEl.value;
  selectEl.innerHTML = "";

  if (includeAll) {
    const optAll = document.createElement("option");
    optAll.value = "all";
    optAll.textContent = "Todos los lugares";
    selectEl.appendChild(optAll);
  }

  state.places.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    selectEl.appendChild(opt);
  });

  if ([...selectEl.options].some((o) => o.value === prev)) {
    selectEl.value = prev;
  }
}

function fillCategoriesSelect(selectEl, includeAll = false) {
  if (!selectEl) return;
  const prev = selectEl.value;
  selectEl.innerHTML = "";

  if (includeAll) {
    const optAll = document.createElement("option");
    optAll.value = "all";
    optAll.textContent = "Todas";
    selectEl.appendChild(optAll);
  }

  state.categories.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    selectEl.appendChild(opt);
  });

  if ([...selectEl.options].some((o) => o.value === prev)) {
    selectEl.value = prev;
  }
}

function ensureDefaultFilterValues() {
  if (placeSelect && !placeSelect.value) placeSelect.value = "all";
  if (statusFilter && !statusFilter.value) statusFilter.value = "all";
  if (typeFilter && !typeFilter.value) typeFilter.value = "all";
  if (priorityFilter && !priorityFilter.value) priorityFilter.value = "all";
  if (categoryFilter && !categoryFilter.value) categoryFilter.value = "all";
  if (sortBy && !sortBy.value) sortBy.value = "smart";
}

function hydrateUI() {
  fillPlacesSelect(placeSelect, { includeAll: true });
  fillPlacesSelect(placeIn, { includeAll: false });

  fillCategoriesSelect(categoryFilter, true);
  fillCategoriesSelect(categoryIn, false);

  ensureDefaultFilterValues();

  if (placeSelect && !placeSelect.value) placeSelect.value = "all";
  if (placeIn && !placeIn.value) placeIn.value = state.places[0]?.id || "musicala";
}

function resetFilters() {
  if (placeSelect) placeSelect.value = "all";
  if (statusFilter) statusFilter.value = "all";
  if (typeFilter) typeFilter.value = "all";
  if (priorityFilter) priorityFilter.value = "all";
  if (categoryFilter) categoryFilter.value = "all";
  if (sortBy) sortBy.value = "smart";
  if (q) q.value = "";
  if (onlyOverdue) onlyOverdue.checked = false;
  if (onlyRecurring) onlyRecurring.checked = false;
}

/* =========================
   Modal: new/edit task
========================= */
function computeNextHint(dueDate, everyDays, recurringEnabled) {
  if (!recurringEnabled) return "";
  const days = clampInt(everyDays, 1, 365, 30);
  const base = dueDate || todayYMD();
  const next = addDays(base, days);
  return next ? `Próxima: ${next}` : "";
}

function updateRecurringUI() {
  if (!recurringIn || !everyDaysIn || !nextHintIn || !dueDateIn) return;
  const enabled = recurringIn.checked;
  everyDaysIn.disabled = !enabled;
  nextHintIn.value = computeNextHint(dueDateIn.value, everyDaysIn.value, enabled);
}

function openModal(editTask = null) {
  if (!modal || !form) return;

  const isEdit = !!editTask;
  if (modalTitle) modalTitle.textContent = isEdit ? "Editar tarea" : "Nueva tarea";
  if (btnDelete) btnDelete.hidden = !isEdit;

  const placeDefault =
    placeSelect?.value && placeSelect.value !== "all"
      ? placeSelect.value
      : (state.places[0]?.id || "musicala");

  if (!isEdit) {
    taskId.value = "";
    titleIn.value = "";
    notesIn.value = "";
    placeIn.value = placeDefault;
    typeIn.value = "reponer";
    categoryIn.value = state.categories.includes("General") ? "General" : (state.categories[0] || "General");
    priorityIn.value = "2";
    statusIn.value = "todo";
    dueDateIn.value = "";
    costIn.value = "";
    recurringIn.checked = false;
    everyDaysIn.value = "30";
    nextHintIn.value = "";
  } else {
    taskId.value = editTask.id;
    titleIn.value = editTask.title ?? "";
    notesIn.value = editTask.notes ?? "";
    placeIn.value = editTask.placeId ?? placeDefault;
    typeIn.value = editTask.type ?? "reponer";
    categoryIn.value = editTask.category ?? "General";
    priorityIn.value = String(editTask.priority ?? 2);
    statusIn.value = editTask.status ?? "todo";
    dueDateIn.value = editTask.dueDate ?? "";
    costIn.value = editTask.cost ? String(editTask.cost) : "";
    recurringIn.checked = !!editTask.recurring?.enabled;
    everyDaysIn.value = editTask.recurring?.everyDays ? String(editTask.recurring.everyDays) : "30";
    nextHintIn.value = computeNextHint(dueDateIn.value, everyDaysIn.value, recurringIn.checked);
  }

  updateRecurringUI();
  modal.showModal();
  titleIn?.focus();
}

function closeModal() {
  if (modal?.open) modal.close();
}

function readFormTask(existing = null) {
  const id = taskId.value || uid();
  const title = (titleIn.value || "").trim();
  const notes = (notesIn.value || "").trim();
  const placeId = placeIn.value;
  const type = typeIn.value;
  const category = (categoryIn.value || "General").trim();
  const priority = clampInt(priorityIn.value, 1, 3, 2);
  const status = statusIn.value;
  const dueDate = dueDateIn.value || "";
  const cost = sanitizeCost(costIn.value);
  const recurringEnabled = !!recurringIn.checked;
  const everyDays = clampInt(everyDaysIn.value, 1, 365, 30);

  const base = existing || {};
  return {
    ...base,
    id,
    title,
    notes,
    placeId,
    type,
    category,
    priority,
    status,
    dueDate,
    cost,
    recurring: recurringEnabled ? { enabled: true, everyDays } : { enabled: false, everyDays },
    createdAt: base.createdAt || nowISO(),
    updatedAt: nowISO()
  };
}

/* =========================
   Query helpers
========================= */
function getPlaceName(id) {
  return state.places.find((p) => p.id === id)?.name ?? id;
}

function getScopePlaceId() {
  return placeSelect?.value || "all";
}

function getScopeTasks() {
  const place = getScopePlaceId();
  if (!place || place === "all") return state.tasks.slice();
  return state.tasks.filter((t) => t.placeId === place);
}

function getQueryHaystack(t) {
  return [
    t.title || "",
    t.notes || "",
    t.category || "",
    getPlaceName(t.placeId),
    typeLabel(t.type),
    statusLabel(t.status),
    priorityLabel(t.priority),
    t.dueDate || ""
  ].join(" ").toLowerCase();
}

function taskMatchesFilters(t) {
  const place = placeSelect?.value || "all";
  const st = statusFilter?.value || "all";
  const ty = typeFilter?.value || "all";
  const pr = priorityFilter?.value || "all";
  const cat = categoryFilter?.value || "all";
  const query = (q?.value || "").trim().toLowerCase();
  const overdueOnly = !!onlyOverdue?.checked;
  const recurringOnly = !!onlyRecurring?.checked;

  if (place !== "all" && t.placeId !== place) return false;
  if (st !== "all" && t.status !== st) return false;
  if (ty !== "all" && t.type !== ty) return false;
  if (pr !== "all" && String(t.priority) !== String(pr)) return false;
  if (cat !== "all" && (t.category || "General") !== cat) return false;
  if (overdueOnly && !isOverdue(t)) return false;
  if (recurringOnly && !t.recurring?.enabled) return false;

  if (query) {
    const hay = getQueryHaystack(t);
    if (!hay.includes(query)) return false;
  }

  return true;
}

function sortTasks(a, b) {
  const mode = sortBy?.value || "smart";

  const updatedA = Date.parse(a.updatedAt ?? a.createdAt ?? 0) || 0;
  const updatedB = Date.parse(b.updatedAt ?? b.createdAt ?? 0) || 0;
  const costA = parseCost(a.cost);
  const costB = parseCost(b.cost);
  const dueA = a.dueDate || "9999-12-31";
  const dueB = b.dueDate || "9999-12-31";
  const priA = Number(a.priority ?? 2);
  const priB = Number(b.priority ?? 2);

  switch (mode) {
    case "updated_desc":
      return updatedB - updatedA;
    case "updated_asc":
      return updatedA - updatedB;
    case "priority_desc":
      return priB - priA || updatedB - updatedA;
    case "priority_asc":
      return priA - priB || updatedB - updatedA;
    case "due_asc":
      return compareText(dueA, dueB) || updatedB - updatedA;
    case "due_desc":
      return compareText(dueB, dueA) || updatedB - updatedA;
    case "cost_desc":
      return costB - costA || updatedB - updatedA;
    case "cost_asc":
      return costA - costB || updatedB - updatedA;
    case "title_asc":
      return compareText(a.title, b.title) || updatedB - updatedA;
    case "smart":
    default: {
      const order = { todo: 0, doing: 1, done: 2 };
      const oa = order[a.status] ?? 9;
      const ob = order[b.status] ?? 9;
      if (oa !== ob) return oa - ob;

      if (isOverdue(a) !== isOverdue(b)) return isOverdue(a) ? -1 : 1;
      if (priA !== priB) return priB - priA;
      if (dueA !== dueB) return compareText(dueA, dueB);
      return updatedB - updatedA;
    }
  }
}

function badge(text, cls = "") {
  const span = document.createElement("span");
  span.className = `badge ${cls}`.trim();
  span.textContent = text;
  return span;
}

/* =========================
   Stats
========================= */
function countMap(entries) {
  const map = new Map();
  for (const value of entries) {
    map.set(value, (map.get(value) || 0) + 1);
  }
  return map;
}

function topEntries(map, limit = 6) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
    .slice(0, limit);
}

function computeStatsFromTasks(tasks) {
  const todo = tasks.filter((t) => t.status === "todo").length;
  const doing = tasks.filter((t) => t.status === "doing").length;
  const done = tasks.filter((t) => t.status === "done").length;
  const overdue = tasks.filter((t) => isOverdue(t)).length;
  const recurring = tasks.filter((t) => t.recurring?.enabled).length;
  const totalCost = tasks.reduce((acc, t) => acc + parseCost(t.cost), 0);

  const completion = tasks.length ? (done / tasks.length) * 100 : 0;

  const topCats = topEntries(countMap(tasks.map((t) => t.category || "General")), 6);
  const topTypes = topEntries(countMap(tasks.map((t) => typeLabel(t.type))), 4);
  const topPlaces = topEntries(countMap(tasks.map((t) => getPlaceName(t.placeId))), 6);

  return {
    tasksCount: tasks.length,
    todo,
    doing,
    done,
    overdue,
    recurring,
    totalCost,
    completion,
    topCats,
    topTypes,
    topPlaces
  };
}

function computeStats(placeId = "all") {
  const tasks = placeId === "all"
    ? state.tasks.slice()
    : state.tasks.filter((t) => t.placeId === placeId);
  return computeStatsFromTasks(tasks);
}

function computeGlobalInsights(tasks) {
  const stats = computeStatsFromTasks(tasks);
  const nearestDue = tasks
    .filter((t) => t.status !== "done" && t.dueDate)
    .sort((a, b) => compareText(a.dueDate, b.dueDate))[0] || null;

  let health = "Sin datos";
  if (stats.tasksCount === 0) {
    health = "Todo tranquilo";
  } else if (stats.overdue > 0) {
    health = `${stats.overdue} vencida${stats.overdue === 1 ? "" : "s"}`;
  } else if (stats.todo > 0 || stats.doing > 0) {
    health = `${stats.todo + stats.doing} activa${(stats.todo + stats.doing) === 1 ? "" : "s"}`;
  } else {
    health = "Todo al día";
  }

  return {
    health,
    place: stats.topPlaces[0]?.[0] || "Sin datos",
    category: stats.topCats[0]?.[0] || "Sin datos",
    focus: nearestDue
      ? `${nearestDue.title} · ${nearestDue.dueDate}`
      : (stats.todo + stats.doing > 0 ? "Revisar pendientes" : "Nada urgente")
  };
}

function renderStats() {
  const scopeTasks = getScopeTasks();
  const stats = computeStatsFromTasks(scopeTasks);
  const scope = getScopePlaceId();

  if (statTotal) statTotal.textContent = String(stats.tasksCount);
  if (statTodo) statTodo.textContent = String(stats.todo);
  if (statDoing) statDoing.textContent = String(stats.doing);
  if (statDone) statDone.textContent = String(stats.done);
  if (statOverdue) statOverdue.textContent = String(stats.overdue);
  if (statRecurring) statRecurring.textContent = String(stats.recurring);
  if (statCost) statCost.textContent = formatCOP(stats.totalCost);
  if (statCompletion) statCompletion.textContent = formatPercent(stats.completion);

  if (summaryContext) {
    summaryContext.textContent =
      scope === "all"
        ? "Vista general de todos los lugares"
        : `Vista enfocada en ${getPlaceName(scope)}`;
  }

  const insights = computeGlobalInsights(scopeTasks);

  if (insightHealth) insightHealth.textContent = insights.health;
  if (insightPlace) insightPlace.textContent = insights.place;
  if (insightCategory) insightCategory.textContent = insights.category;
  if (insightFocus) insightFocus.textContent = insights.focus;
}

/* =========================
   Rendering
========================= */
function renderViewMode() {
  document.body.classList.toggle("view-compact", uiState.viewMode === "compact");

  if (viewDetailed) {
    const active = uiState.viewMode === "detailed";
    viewDetailed.classList.toggle("is-active", active);
    viewDetailed.setAttribute("aria-pressed", String(active));
  }

  if (viewCompact) {
    const active = uiState.viewMode === "compact";
    viewCompact.classList.toggle("is-active", active);
    viewCompact.setAttribute("aria-pressed", String(active));
  }
}

function setViewMode(mode) {
  uiState.viewMode = mode === "compact" ? "compact" : "detailed";
  saveUIState();
  renderViewMode();
}

function renderListMeta(items, totalInScope) {
  if (resultsCount) {
    const shown = items.length;
    const scopeText = getScopePlaceId() === "all" ? "globales" : "del lugar";
    resultsCount.textContent = `${shown} de ${totalInScope} ${scopeText}`;
  }

  if (listHint) {
    const parts = [];
    if (getScopePlaceId() === "all") parts.push("Mostrando todos los lugares");
    else parts.push(`Lugar: ${getPlaceName(getScopePlaceId())}`);

    if (onlyOverdue?.checked) parts.push("solo vencidas");
    if (onlyRecurring?.checked) parts.push("solo recurrentes");
    if ((q?.value || "").trim()) parts.push(`búsqueda: "${q.value.trim()}"`);

    listHint.textContent = parts.join(" • ");
  }
}

function renderTaskCard(t) {
  const card = document.createElement("div");
  card.className = "card";
  if (isOverdue(t)) card.classList.add("is-overdue");
  if (t.status === "done") card.classList.add("is-done");
  if (t.status === "doing") card.classList.add("is-doing");

  const left = document.createElement("div");
  const head = document.createElement("div");
  head.className = "card-title";

  const h3 = document.createElement("h3");
  h3.textContent = t.title || "(Sin título)";
  head.appendChild(h3);

  const badgesBox = document.createElement("div");
  badgesBox.className = "badges";

  badgesBox.appendChild(badge(getPlaceName(t.placeId), "muted"));
  badgesBox.appendChild(badge(typeLabel(t.type), "muted"));
  badgesBox.appendChild(badge(t.category || "General", "muted"));
  badgesBox.appendChild(badge(priorityLabel(t.priority), `pri-${t.priority || 2}`));
  badgesBox.appendChild(badge(statusLabel(t.status), t.status));

  if (t.dueDate) {
    badgesBox.appendChild(badge(`Vence: ${t.dueDate}`, isOverdue(t) ? "overdue" : "muted"));
  }
  if (parseCost(t.cost) > 0) {
    badgesBox.appendChild(badge(formatCOP(t.cost), "muted"));
  }
  if (t.recurring?.enabled) {
    badgesBox.appendChild(badge(`Recurrente ${t.recurring.everyDays}d`, "recurring"));
  }
  if (isDueSoon(t, 7) && !isOverdue(t)) {
    badgesBox.appendChild(badge("Pronto", "muted"));
  }

  head.appendChild(badgesBox);
  left.appendChild(head);

  if (t.notes) {
    const notes = document.createElement("div");
    notes.className = "card-notes";
    notes.textContent = t.notes;
    left.appendChild(notes);
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  meta.innerHTML = [
    `Actualizado: ${escapeHTML(formatDate(t.updatedAt || t.createdAt))}`,
    t.createdAt ? `Creado: ${escapeHTML(formatDate(t.createdAt))}` : "",
    t.dueDate ? `Fecha límite: ${escapeHTML(t.dueDate)}` : ""
  ].filter(Boolean).join(" • ");
  left.appendChild(meta);

  const right = document.createElement("div");
  right.className = "actions";

  const btnFlow = document.createElement("button");
  btnFlow.className = "pill ok";
  btnFlow.type = "button";
  btnFlow.textContent = t.status === "done" ? "↺" : (t.status === "doing" ? "✅" : "▶");
  btnFlow.title =
    t.status === "done"
      ? "Volver a pendiente"
      : (t.status === "doing" ? "Marcar como hecho" : "Pasar a en proceso");
  btnFlow.addEventListener("click", () => setStatus(t.id, nextStatus(t.status)));

  const btnPostpone = document.createElement("button");
  btnPostpone.className = "pill";
  btnPostpone.type = "button";
  btnPostpone.textContent = "＋7d";
  btnPostpone.title = "Posponer 7 días";
  btnPostpone.addEventListener("click", () => postponeTask(t.id, 7));

  const btnEdit = document.createElement("button");
  btnEdit.className = "pill edit";
  btnEdit.type = "button";
  btnEdit.textContent = "✏️";
  btnEdit.title = "Editar";
  btnEdit.addEventListener("click", () => openModal(getTask(t.id)));

  const btnTrash = document.createElement("button");
  btnTrash.className = "pill trash";
  btnTrash.type = "button";
  btnTrash.textContent = "🗑️";
  btnTrash.title = "Eliminar";
  btnTrash.addEventListener("click", () => deleteTask(t.id));

  right.appendChild(btnFlow);
  right.appendChild(btnPostpone);
  right.appendChild(btnEdit);
  right.appendChild(btnTrash);

  card.appendChild(left);
  card.appendChild(right);

  return card;
}

function render() {
  ensureDefaultFilterValues();
  renderViewMode();
  renderStats();

  if (!list || !empty) return;

  const scopeTasks = getScopeTasks();
  const items = scopeTasks
    .filter(taskMatchesFilters)
    .slice()
    .sort(sortTasks);

  renderListMeta(items, scopeTasks.length);

  list.innerHTML = "";
  empty.hidden = items.length !== 0;

  const frag = document.createDocumentFragment();
  for (const t of items) {
    frag.appendChild(renderTaskCard(t));
  }
  list.appendChild(frag);
}

/* =========================
   CRUD
========================= */
function getTask(id) {
  return state.tasks.find((t) => t.id === id) || null;
}

function upsertTask(task, { rerender = true } = {}) {
  const idx = state.tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) state.tasks[idx] = task;
  else state.tasks.push(task);

  saveState(state);
  if (rerender) render();
}

function deleteTask(id) {
  const t = getTask(id);
  if (!t) return;

  const ok = confirm(`¿Eliminar: "${t.title}"?`);
  if (!ok) return;

  state.tasks = state.tasks.filter((x) => x.id !== id);
  saveState(state);
  render();
}

function setStatus(id, status) {
  const t = getTask(id);
  if (!t) return;

  const wasDone = t.status === "done";
  t.status = status;
  t.updatedAt = nowISO();

  upsertTask(t, { rerender: false });

  if (!wasDone && status === "done" && t.recurring?.enabled) {
    createNextRecurring(t);
  }

  render();
}

function postponeTask(id, days = 7) {
  const t = getTask(id);
  if (!t) return;

  const base = t.dueDate || todayYMD();
  t.dueDate = addDays(base, days);
  t.updatedAt = nowISO();

  upsertTask(t);
}

function createNextRecurring(task) {
  const everyDays = clampInt(task.recurring?.everyDays, 1, 365, 30);
  const base = task.dueDate || todayYMD();
  const nextDue = addDays(base, everyDays);

  const next = {
    ...task,
    id: uid(),
    status: "todo",
    createdAt: nowISO(),
    updatedAt: nowISO(),
    dueDate: nextDue || ""
  };

  const dup = state.tasks.some((t) =>
    (t.title || "").trim().toLowerCase() === (next.title || "").trim().toLowerCase() &&
    t.placeId === next.placeId &&
    t.type === next.type &&
    (t.dueDate || "") === (next.dueDate || "") &&
    t.status !== "done"
  );

  if (!dup) {
    state.tasks.push(next);
    saveState(state);
  }
}

/* =========================
   Export / Import
========================= */
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportJSON() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  downloadBlob(`hogares_backup_${todayYMD()}.json`, blob);
}

function exportCSV() {
  const rows = [
    [
      "id",
      "titulo",
      "notas",
      "lugar_id",
      "lugar",
      "tipo",
      "categoria",
      "prioridad",
      "estado",
      "vence",
      "costo",
      "recurrente",
      "cada_dias",
      "creado",
      "actualizado"
    ]
  ];

  const tasks = getScopeTasks()
    .filter(taskMatchesFilters)
    .slice()
    .sort(sortTasks);

  tasks.forEach((t) => {
    rows.push([
      t.id,
      t.title || "",
      t.notes || "",
      t.placeId || "",
      getPlaceName(t.placeId),
      typeLabel(t.type),
      t.category || "",
      priorityLabel(t.priority),
      statusLabel(t.status),
      t.dueDate || "",
      parseCost(t.cost),
      t.recurring?.enabled ? "sí" : "no",
      t.recurring?.enabled ? t.recurring.everyDays : "",
      t.createdAt || "",
      t.updatedAt || ""
    ]);
  });

  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const scopeName = getScopePlaceId() === "all" ? "todos" : slugId(getPlaceName(getScopePlaceId()));
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(`hogares_${scopeName}_${todayYMD()}.csv`, blob);
}

function importJSONFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incomingRaw = safeJSONParse(String(reader.result || "{}"), null);
      if (!incomingRaw || typeof incomingRaw !== "object") throw new Error("JSON inválido");

      state = normalizeState(incomingRaw);
      saveState(state);
      hydrateUI();
      render();
      alert("Importación lista ✅");
    } catch (e) {
      alert("No pude importar ese archivo. Puede estar dañado o no ser de esta app.");
    } finally {
      if (importFile) importFile.value = "";
    }
  };
  reader.readAsText(file);
}

/* =========================
   Seed templates
========================= */
function seedTemplates() {
  const place =
    (placeSelect?.value && placeSelect.value !== "all" ? placeSelect.value : null) ||
    state.places[0]?.id ||
    "musicala";

  const templates = [
    { title: "Reponer shampoo", type: "reponer", category: "Baño", priority: 2 },
    { title: "Comprar papel higiénico", type: "reponer", category: "Baño", priority: 2, recurring: { enabled: true, everyDays: 21 } },
    { title: "Revisar bombillos", type: "mejorar", category: "General", priority: 1, recurring: { enabled: true, everyDays: 60 } },
    { title: "Arreglar / pintar pared", type: "reparar", category: "General", priority: 3 },
    { title: "Comprar extensiones/cables", type: "comprar", category: "Herramientas", priority: 2 },
    { title: "Arena / comida mascotas", type: "reponer", category: "Mascotas", priority: 2, recurring: { enabled: true, everyDays: 15 } },
    { title: "Limpieza profunda cocina", type: "mejorar", category: "Cocina", priority: 1, recurring: { enabled: true, everyDays: 30 } }
  ];

  const created = templates.map((tpl) => ({
    id: uid(),
    title: tpl.title,
    notes: "",
    placeId: place,
    type: tpl.type,
    category: tpl.category,
    priority: tpl.priority,
    status: "todo",
    dueDate: "",
    cost: "",
    recurring: tpl.recurring?.enabled
      ? { enabled: true, everyDays: tpl.recurring.everyDays }
      : { enabled: false, everyDays: 30 },
    createdAt: nowISO(),
    updatedAt: nowISO()
  }));

  const addable = created.filter((n) =>
    !state.tasks.some((t) =>
      t.placeId === n.placeId &&
      (t.title || "").trim().toLowerCase() === n.title.trim().toLowerCase() &&
      t.status !== "done"
    )
  );

  if (addable.length === 0) {
    alert("Ya tienes estas plantillas o algo muy parecido. No voy a duplicar el caos. 😌");
    return;
  }

  state.tasks.push(...addable);
  saveState(state);
  render();
}

/* =========================
   Menu behavior
========================= */
function closeMoreMenu() {
  if (moreMenu && moreMenu.open) moreMenu.open = false;
}

function wireMenuClose() {
  if (!moreMenu) return;

  document.addEventListener("click", (e) => {
    if (!moreMenu.open) return;
    const inside = moreMenu.contains(e.target);
    if (!inside) closeMoreMenu();
  }, { capture: true });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMoreMenu();
  });
}

/* =========================
   Stats modal
========================= */
let statsDialog = null;

function ensureStatsDialog() {
  if (statsDialog) return statsDialog;

  statsDialog = document.createElement("dialog");
  statsDialog.className = "modal";
  statsDialog.id = "statsModal";
  statsDialog.innerHTML = `
    <form method="dialog" class="modal-card">
      <div class="modal-head">
        <div>
          <div class="modal-title">Estadísticas</div>
          <div class="modal-sub" id="statsSub">Resumen</div>
        </div>
        <button type="button" class="btn icon ghost" id="statsClose" aria-label="Cerrar">✕</button>
      </div>

      <div class="modal-body" id="statsBody"></div>

      <div class="modal-foot">
        <div class="spacer"></div>
        <button class="btn primary" value="ok">Cerrar</button>
      </div>
    </form>
  `;
  document.body.appendChild(statsDialog);

  statsDialog.querySelector("#statsClose").addEventListener("click", () => {
    if (statsDialog.open) statsDialog.close();
  });

  return statsDialog;
}

function statsCardsHTML(s) {
  return `
    <div class="stats" style="padding:0; margin-bottom:12px;">
      <div class="stat"><div class="stat-num">${s.tasksCount}</div><div class="stat-lbl">Total</div></div>
      <div class="stat"><div class="stat-num">${s.todo}</div><div class="stat-lbl">Pendientes</div></div>
      <div class="stat"><div class="stat-num">${s.doing}</div><div class="stat-lbl">En proceso</div></div>
      <div class="stat"><div class="stat-num">${s.done}</div><div class="stat-lbl">Hechos</div></div>
      <div class="stat"><div class="stat-num">${s.overdue}</div><div class="stat-lbl">Vencidas</div></div>
      <div class="stat"><div class="stat-num">${s.recurring}</div><div class="stat-lbl">Recurrentes</div></div>
      <div class="stat"><div class="stat-num">${escapeHTML(formatCOP(s.totalCost))}</div><div class="stat-lbl">Costo total</div></div>
      <div class="stat"><div class="stat-num">${formatPercent(s.completion)}</div><div class="stat-lbl">Completado</div></div>
    </div>
  `;
}

function badgesHTML(entries, emptyText = "Sin datos") {
  return entries.length
    ? entries.map(([label, count]) => `<span class="badge muted">${escapeHTML(label)} · ${count}</span>`).join("")
    : `<span class="badge muted">${escapeHTML(emptyText)}</span>`;
}

function openStats() {
  const dlg = ensureStatsDialog();

  const scopeId = getScopePlaceId();
  const scopeName = scopeId === "all" ? "Todos los lugares" : getPlaceName(scopeId);
  const scopeStats = computeStats(scopeId);
  const globalStats = computeStats("all");

  const body = dlg.querySelector("#statsBody");
  const sub = dlg.querySelector("#statsSub");

  sub.textContent =
    scopeId === "all"
      ? "Vista general de toda la app"
      : `Lugar: ${scopeName}`;

  const placeComparison = topEntries(
    countMap(state.tasks.map((t) => getPlaceName(t.placeId))),
    20
  );

  body.innerHTML = `
    ${statsCardsHTML(scopeStats)}

    <div class="card" style="margin:0 0 12px; grid-template-columns:1fr;">
      <div class="meta" style="margin-top:0;">Resumen actual</div>
      <div class="badges" style="margin-top:8px;">
        ${badgesHTML(scopeStats.topCats, "Sin categorías")}
      </div>

      <div class="meta" style="margin-top:12px;">Tipos más frecuentes</div>
      <div class="badges" style="margin-top:8px;">
        ${badgesHTML(scopeStats.topTypes, "Sin tipos")}
      </div>

      <div class="meta" style="margin-top:12px;">Distribución por lugar</div>
      <div class="badges" style="margin-top:8px;">
        ${badgesHTML(scopeId === "all" ? placeComparison : scopeStats.topPlaces, "Sin lugares")}
      </div>
    </div>

    ${scopeId === "all" ? "" : `
      <div class="card" style="margin:0; grid-template-columns:1fr;">
        <div class="meta" style="margin-top:0;">Comparativo global</div>
        <div class="badges" style="margin-top:8px;">
          <span class="badge muted">Global total: ${globalStats.tasksCount}</span>
          <span class="badge muted">Global vencidas: ${globalStats.overdue}</span>
          <span class="badge muted">Global costo: ${escapeHTML(formatCOP(globalStats.totalCost))}</span>
          <span class="badge muted">Participación: ${globalStats.tasksCount ? formatPercent((scopeStats.tasksCount / globalStats.tasksCount) * 100) : "0%"}</span>
        </div>
      </div>
    `}
  `;

  dlg.showModal();
}

/* =========================
   Settings modal
========================= */
let settingsDialog = null;

function ensureSettingsDialog() {
  if (settingsDialog) return settingsDialog;

  settingsDialog = document.createElement("dialog");
  settingsDialog.className = "modal";
  settingsDialog.id = "settingsModal";
  settingsDialog.innerHTML = `
    <form method="dialog" class="modal-card">
      <div class="modal-head">
        <div>
          <div class="modal-title">Ajustes</div>
          <div class="modal-sub">Configura lugares y categorías sin romper nada.</div>
        </div>
        <button type="button" class="btn icon ghost" id="settingsClose" aria-label="Cerrar">✕</button>
      </div>

      <div class="modal-body">
        <div class="grid">
          <div class="field span-2">
            <label>Lugares</label>
            <div class="card" style="margin:0; grid-template-columns: 1fr;">
              <div class="badges" style="margin-bottom:10px;">
                <input id="newPlaceName" placeholder="Nuevo lugar (ej: Bodega)" />
                <button type="button" class="btn" id="btnAddPlace">Agregar</button>
              </div>
              <div id="placesList"></div>
            </div>
          </div>

          <div class="field span-2">
            <label>Categorías</label>
            <div class="card" style="margin:0; grid-template-columns: 1fr;">
              <div class="badges" style="margin-bottom:10px;">
                <input id="newCatName" placeholder="Nueva categoría (ej: Pintura)" />
                <button type="button" class="btn" id="btnAddCat">Agregar</button>
              </div>
              <div id="catsList"></div>
            </div>
          </div>

          <div class="field span-2">
            <div class="muted">
              No te dejo borrar un lugar o categoría si está en uso. Porque después el pasado te persigue. 🫠
            </div>
          </div>
        </div>
      </div>

      <div class="modal-foot">
        <button type="button" class="btn" id="btnSeedNow">Crear ejemplos</button>
        <div class="spacer"></div>
        <button class="btn primary" value="ok">Cerrar</button>
      </div>
    </form>
  `;
  document.body.appendChild(settingsDialog);

  settingsDialog.querySelector("#settingsClose").addEventListener("click", () => {
    if (settingsDialog.open) settingsDialog.close();
  });

  settingsDialog.querySelector("#btnSeedNow").addEventListener("click", () => seedTemplates());

  settingsDialog.querySelector("#btnAddPlace").addEventListener("click", () => {
    const inp = settingsDialog.querySelector("#newPlaceName");
    const name = (inp.value || "").trim();
    if (!name) return;
    addPlace(name);
    inp.value = "";
    renderSettingsLists();
  });

  settingsDialog.querySelector("#btnAddCat").addEventListener("click", () => {
    const inp = settingsDialog.querySelector("#newCatName");
    const name = (inp.value || "").trim();
    if (!name) return;
    addCategory(name);
    inp.value = "";
    renderSettingsLists();
  });

  return settingsDialog;
}

function openSettings() {
  const dlg = ensureSettingsDialog();
  renderSettingsLists();
  dlg.showModal();
}

function isPlaceUsed(placeId) {
  return state.tasks.some((t) => t.placeId === placeId);
}

function isCategoryUsed(cat) {
  return state.tasks.some((t) => (t.category || "General") === cat);
}

function addPlace(name) {
  const id = slugId(name);
  if (state.places.some((p) => p.id === id)) {
    alert("Ese lugar ya existe. Cámbiale un poquito el nombre. 😅");
    return;
  }
  state.places.push({ id, name });
  saveState(state);
  hydrateUI();
  render();
}

function renamePlace(id, newName) {
  const p = state.places.find((x) => x.id === id);
  if (!p) return;
  p.name = newName.trim() || p.name;
  saveState(state);
  hydrateUI();
  render();
}

function deletePlace(id) {
  if (isPlaceUsed(id)) {
    alert("No puedo borrar ese lugar porque ya tiene tareas. Mueve o borra tareas primero.");
    return;
  }
  state.places = state.places.filter((p) => p.id !== id);
  if (state.places.length === 0) state.places = DEFAULT_PLACES.map((p) => ({ ...p }));
  saveState(state);
  hydrateUI();
  render();
}

function addCategory(name) {
  const c = name.trim();
  if (!c) return;
  if (state.categories.includes(c)) {
    alert("Esa categoría ya existe.");
    return;
  }
  state.categories.push(c);
  saveState(state);
  hydrateUI();
  render();
}

function renameCategory(oldName, newName) {
  const nn = newName.trim();
  if (!nn) return;
  if (state.categories.includes(nn) && nn !== oldName) {
    alert("Ya existe una categoría con ese nombre.");
    return;
  }

  state.categories = state.categories.map((c) => (c === oldName ? nn : c));
  state.tasks = state.tasks.map((t) => ({
    ...t,
    category: (t.category || "General") === oldName ? nn : t.category
  }));

  saveState(state);
  hydrateUI();
  render();
}

function moveCategory(name, dir) {
  const i = state.categories.indexOf(name);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= state.categories.length) return;
  const arr = state.categories.slice();
  [arr[i], arr[j]] = [arr[j], arr[i]];
  state.categories = arr;
  saveState(state);
  hydrateUI();
  render();
}

function deleteCategory(name) {
  if (isCategoryUsed(name)) {
    alert("No puedo borrar esa categoría porque ya está en uso.");
    return;
  }
  state.categories = state.categories.filter((c) => c !== name);
  if (state.categories.length === 0) state.categories = DEFAULT_CATEGORIES.slice();
  saveState(state);
  hydrateUI();
  render();
}

function renderSettingsLists() {
  const dlg = ensureSettingsDialog();
  const placesWrap = dlg.querySelector("#placesList");
  const catsWrap = dlg.querySelector("#catsList");

  placesWrap.innerHTML = "";
  for (const p of state.places) {
    const row = document.createElement("div");
    row.className = "card";
    row.style.margin = "10px 0 0";
    row.style.gridTemplateColumns = "1fr auto";
    row.innerHTML = `
      <div>
        <div class="card-title"><h3 style="margin:0; font-size:13px;">${escapeHTML(p.name)}</h3></div>
        <div class="meta" style="margin-top:6px;">id: ${escapeHTML(p.id)} ${isPlaceUsed(p.id) ? "· en uso" : "· libre"}</div>
      </div>
      <div class="actions">
        <button type="button" class="pill edit" title="Renombrar">✏️</button>
        <button type="button" class="pill trash" title="Eliminar">🗑️</button>
      </div>
    `;

    const [btnEdit, btnTrash] = row.querySelectorAll("button");
    btnEdit.addEventListener("click", () => {
      const nn = prompt("Nuevo nombre del lugar:", p.name);
      if (nn && nn.trim()) renamePlace(p.id, nn.trim());
      renderSettingsLists();
    });

    btnTrash.addEventListener("click", () => {
      const ok = confirm(`¿Eliminar lugar "${p.name}"?`);
      if (!ok) return;
      deletePlace(p.id);
      renderSettingsLists();
    });

    placesWrap.appendChild(row);
  }

  catsWrap.innerHTML = "";
  for (const c of state.categories) {
    const row = document.createElement("div");
    row.className = "card";
    row.style.margin = "10px 0 0";
    row.style.gridTemplateColumns = "1fr auto";
    row.innerHTML = `
      <div>
        <div class="card-title"><h3 style="margin:0; font-size:13px;">${escapeHTML(c)}</h3></div>
        <div class="meta" style="margin-top:6px;">${isCategoryUsed(c) ? "en uso" : "libre"}</div>
      </div>
      <div class="actions">
        <button type="button" class="pill" title="Subir">⬆️</button>
        <button type="button" class="pill" title="Bajar">⬇️</button>
        <button type="button" class="pill edit" title="Renombrar">✏️</button>
        <button type="button" class="pill trash" title="Eliminar">🗑️</button>
      </div>
    `;

    const btns = row.querySelectorAll("button");
    const btnUp = btns[0];
    const btnDown = btns[1];
    const btnEdit = btns[2];
    const btnTrash = btns[3];

    btnUp.addEventListener("click", () => { moveCategory(c, -1); renderSettingsLists(); });
    btnDown.addEventListener("click", () => { moveCategory(c, +1); renderSettingsLists(); });

    btnEdit.addEventListener("click", () => {
      const nn = prompt("Nuevo nombre de la categoría:", c);
      if (nn && nn.trim()) renameCategory(c, nn.trim());
      renderSettingsLists();
    });

    btnTrash.addEventListener("click", () => {
      const ok = confirm(`¿Eliminar categoría "${c}"?`);
      if (!ok) return;
      deleteCategory(c);
      renderSettingsLists();
    });

    catsWrap.appendChild(row);
  }
}

/* =========================
   PWA
========================= */
function registerPWA() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(() => {
    /* silencio, que tampoco es para hacer novela */
  });
}

/* =========================
   Events
========================= */
function safeOn(el, evt, fn) {
  if (!el) return;
  el.addEventListener(evt, fn);
}

safeOn(btnNew, "click", () => openModal(null));
safeOn(btnExport, "click", () => exportJSON());
safeOn(btnExportCsv, "click", () => exportCSV());

safeOn(importFile, "change", (e) => {
  const file = e.target.files?.[0];
  if (file) importJSONFile(file);
});

if (btnSeed) safeOn(btnSeed, "click", () => seedTemplates());

safeOn(btnStats, "click", () => openStats());
safeOn(btnSettings, "click", () => openSettings());

safeOn(btnClose, "click", () => closeModal());
safeOn(btnCancel, "click", () => closeModal());

safeOn(btnClearFilters, "click", () => {
  resetFilters();
  render();
});

safeOn(viewDetailed, "click", () => setViewMode("detailed"));
safeOn(viewCompact, "click", () => setViewMode("compact"));
safeOn(btnExpandAll, "click", () => setViewMode("detailed"));
safeOn(btnCollapseAll, "click", () => setViewMode("compact"));

[
  placeSelect,
  statusFilter,
  typeFilter,
  priorityFilter,
  categoryFilter,
  sortBy,
  onlyOverdue,
  onlyRecurring
].forEach((el) => {
  safeOn(el, "change", render);
});

const renderDebounced = debounce(render, 120);
safeOn(q, "input", renderDebounced);

safeOn(recurringIn, "change", updateRecurringUI);
safeOn(everyDaysIn, "input", updateRecurringUI);
safeOn(dueDateIn, "change", updateRecurringUI);

safeOn(form, "submit", (e) => {
  e.preventDefault();

  const id = taskId?.value;
  const existing = id ? getTask(id) : null;
  const t = readFormTask(existing);

  if (!t.title) {
    alert("Ponle un título, por lo menos. 🙃");
    return;
  }

  upsertTask(t);
  closeModal();
});

safeOn(btnDelete, "click", () => {
  const id = taskId?.value;
  if (!id) return;
  closeModal();
  deleteTask(id);
});

document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "n" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    openModal(null);
  }

  if (e.key === "Escape" && modal?.open) {
    closeModal();
  }
});

wireMenuClose();

/* =========================
   Boot
========================= */
hydrateUI();
renderViewMode();
render();
registerPWA();
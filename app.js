/* Hogares | Musicala
   PWA + LocalStorage CRUD + filtros + export/import + recurrentes
   + Stats globales + filtros avanzados + CSV + vista compacta/detallada
   Mantiene LS_KEY y estructura base para no romper instalaciones existentes.
*/

"use strict";

const LS_KEY = "hogares_pwa_v1";
const UI_KEY = "hogares_pwa_ui_v1";

/* Antigüedad: el punto de la app es que las cosas no se queden ahí.
   A partir de STALE_DAYS sin cerrarse, una tarea empieza a pesar más. */
const STALE_DAYS = 30;
const STALE_MONTHS_LEVEL = 90;   // ~3 meses
const STALE_FOREVER_LEVEL = 180; // ~6 meses
const FOCUS_MAX = 4;

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

/* =========================
   Antigüedad / estancamiento
========================= */
function daysSince(iso) {
  if (!iso) return 0;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 0;
  const ms = Date.now() - d.getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

function taskAgeDays(t) {
  return daysSince(t?.createdAt);
}

function isStalled(t) {
  if (!t || t.status === "done") return false;
  return taskAgeDays(t) >= STALE_DAYS;
}

function stallLevel(t) {
  if (!isStalled(t)) return 0;
  const age = taskAgeDays(t);
  if (age >= STALE_FOREVER_LEVEL) return 3;
  if (age >= STALE_MONTHS_LEVEL) return 2;
  return 1;
}

function humanAge(days) {
  const d = Math.max(0, Math.floor(Number(days) || 0));
  if (d < 1) return "hoy";
  if (d === 1) return "1 día";
  if (d < 30) return `${d} días`;

  const months = Math.floor(d / 30);
  if (months < 12) return months === 1 ? "1 mes" : `${months} meses`;

  const years = Math.floor(d / 365);
  return years === 1 ? "1 año" : `${years} años`;
}

/* Presión: cuánto empuja hacia arriba el hecho de llevar tiempo ahí.
   Lo roto pesa más, porque seguir roto es peor que seguir sin mejorar. */
function stallPressure(t) {
  if (!t || t.status === "done") return 0;
  const age = Math.min(taskAgeDays(t), 365);
  const weight = t.type === "reparar" ? 1.5 : 1;
  return age * weight;
}

/* Un solo número que mezcla vencimiento, prioridad y antigüedad.
   Vencido siempre gana; después compiten prioridad y tiempo estancado. */
function urgencyScore(t) {
  if (!t) return 0;
  let score = 0;

  if (isOverdue(t)) score += 1000 + daysSince(t.dueDate);
  else if (isDueSoon(t, 7)) score += 400;

  score += clampInt(t.priority, 1, 3, 2) * 100;
  score += stallPressure(t);

  if (t.status === "doing") score += 50;

  return score;
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
const onlyStalled = $("#onlyStalled");
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
const statStalled = $("#statStalled");
const progressFill = $("#progressFill");

const summaryContext = $("#summaryContext");
const insightHealth = $("#insightHealth");
const insightPlace = $("#insightPlace");
const insightCategory = $("#insightCategory");
const insightFocus = $("#insightFocus");
const insightStalled = $("#insightStalled");

const focusPanel = $("#focusPanel");
const focusList = $("#focusList");
const focusSub = $("#focusSub");

const btnNew = $("#btnNew");
const btnExport = $("#btnExport");
const btnExportCsv = $("#btnExportCsv");
const importFile = $("#importFile");
const btnStats = $("#btnStats");
const btnSettings = $("#btnSettings");
const moreMenu = $("#moreMenu");

const viewDetailed = $("#viewDetailed");
const viewCompact = $("#viewCompact");

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
  if (onlyStalled) onlyStalled.checked = false;
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
  const stalledOnly = !!onlyStalled?.checked;

  if (place !== "all" && t.placeId !== place) return false;
  if (stalledOnly && !isStalled(t)) return false;
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

/* Ordenar con las claves precalculadas una sola vez por tarea,
   en vez de reparsear fechas en cada comparación. */
function sortDecorate(t) {
  return {
    task: t,
    updated: Date.parse(t.updatedAt ?? t.createdAt ?? 0) || 0,
    cost: parseCost(t.cost),
    due: t.dueDate || "9999-12-31",
    pri: clampInt(t.priority, 1, 3, 2),
    age: taskAgeDays(t),
    score: urgencyScore(t),
    closed: t.status === "done" ? 1 : 0,
    title: t.title || ""
  };
}

function cmpDue(a, b) {
  return a < b ? -1 : (a > b ? 1 : 0);
}

function compareDecorated(a, b, mode) {
  switch (mode) {
    case "updated_desc":
      return b.updated - a.updated;
    case "updated_asc":
      return a.updated - b.updated;
    case "priority_desc":
      return b.pri - a.pri || b.updated - a.updated;
    case "priority_asc":
      return a.pri - b.pri || b.updated - a.updated;
    case "due_asc":
      return cmpDue(a.due, b.due) || b.updated - a.updated;
    case "due_desc":
      return cmpDue(b.due, a.due) || b.updated - a.updated;
    case "cost_desc":
      return b.cost - a.cost || b.updated - a.updated;
    case "cost_asc":
      return a.cost - b.cost || b.updated - a.updated;
    case "title_asc":
      return compareText(a.title, b.title) || b.updated - a.updated;
    case "stalled_desc":
      // Lo hecho no está estancado, así que no compite por antigüedad.
      return a.closed - b.closed || b.age - a.age || b.score - a.score;
    case "smart":
    default:
      // Pendiente y en proceso compiten juntos; solo "hecho" se va al final.
      if (a.closed !== b.closed) return a.closed - b.closed;
      if (a.closed === 1) return b.updated - a.updated;
      return (
        b.score - a.score ||
        b.age - a.age ||
        cmpDue(a.due, b.due) ||
        b.updated - a.updated
      );
  }
}

function sortTasksList(tasks, mode = sortBy?.value || "smart") {
  return tasks
    .map(sortDecorate)
    .sort((a, b) => compareDecorated(a, b, mode))
    .map((d) => d.task);
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

  const stalledTasks = tasks.filter(isStalled);
  const stalled = stalledTasks.length;
  const oldest = stalledTasks
    .slice()
    .sort((a, b) => taskAgeDays(b) - taskAgeDays(a))[0] || null;

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
    stalled,
    oldest,
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

  // El foco ya no depende de tener fecha: lo elige el puntaje completo.
  const nextFocus = tasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => urgencyScore(b) - urgencyScore(a))[0] || null;

  let health = "Sin datos";
  if (stats.tasksCount === 0) {
    health = "Todo tranquilo";
  } else if (stats.overdue > 0) {
    health = `${stats.overdue} vencida${stats.overdue === 1 ? "" : "s"}`;
  } else if (stats.stalled > 0) {
    health = `${stats.stalled} estancada${stats.stalled === 1 ? "" : "s"}`;
  } else if (stats.todo > 0 || stats.doing > 0) {
    health = `${stats.todo + stats.doing} activa${(stats.todo + stats.doing) === 1 ? "" : "s"}`;
  } else {
    health = "Todo al día";
  }

  const focusLabel = nextFocus
    ? (nextFocus.dueDate
        ? `${nextFocus.title} · ${nextFocus.dueDate}`
        : `${nextFocus.title} · lleva ${humanAge(taskAgeDays(nextFocus))}`)
    : "Nada pendiente";

  return {
    health,
    place: stats.topPlaces[0]?.[0] || "Sin datos",
    category: stats.topCats[0]?.[0] || "Sin datos",
    focus: focusLabel,
    stalled: stats.oldest
      ? `${stats.oldest.title} · ${humanAge(taskAgeDays(stats.oldest))}`
      : "Nada estancado 🎉"
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
  if (statStalled) statStalled.textContent = String(stats.stalled);
  if (statCost) statCost.textContent = formatCOP(stats.totalCost);
  if (statCompletion) statCompletion.textContent = formatPercent(stats.completion);
  if (progressFill) progressFill.style.width = `${Math.round(stats.completion)}%`;

  // Sin nada que atender, las cifras de alarma se apagan.
  statOverdue?.closest(".lead")?.classList.toggle("is-calm", stats.overdue === 0);
  statStalled?.closest(".lead")?.classList.toggle("is-calm", stats.stalled === 0);

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
  if (insightStalled) insightStalled.textContent = insights.stalled;
}

/* =========================
   Foco: una cosa por lugar
   La lista completa paraliza. Esto propone lo siguiente concreto.
========================= */
function computeFocusItems() {
  const scope = getScopePlaceId();
  const pending = getScopeTasks().filter((t) => t.status !== "done");
  if (pending.length === 0) return [];

  const ranked = pending.slice().sort((a, b) => urgencyScore(b) - urgencyScore(a));

  // Con un lugar seleccionado el foco es dentro de ese lugar;
  // en la vista global es una cosa por lugar, para no mirar solo al más caótico.
  if (scope !== "all") return ranked.slice(0, FOCUS_MAX);

  const byPlace = new Map();
  for (const t of ranked) {
    if (!byPlace.has(t.placeId)) byPlace.set(t.placeId, t);
  }

  return Array.from(byPlace.values()).slice(0, FOCUS_MAX);
}

function renderFocus() {
  if (!focusPanel || !focusList) return;

  const items = computeFocusItems();
  focusPanel.hidden = items.length === 0;

  if (focusSub) {
    const scope = getScopePlaceId();
    if (items.length === 0) {
      focusSub.textContent = "Nada pendiente por ahora.";
    } else if (scope === "all") {
      focusSub.textContent = `Lo siguiente en ${items.length} ${items.length === 1 ? "lugar" : "lugares"}. Una cosa a la vez.`;
    } else {
      focusSub.textContent = `Lo siguiente en ${getPlaceName(scope)}. Una cosa a la vez.`;
    }
  }

  focusList.innerHTML = "";
  if (items.length === 0) return;

  const frag = document.createDocumentFragment();

  for (const t of items) {
    const row = document.createElement("div");
    row.className = "focus-item";
    if (stallLevel(t) >= 2) row.classList.add("is-stalled");

    const info = document.createElement("button");
    info.type = "button";
    info.className = "focus-open";
    info.title = "Editar esta tarea";
    info.innerHTML = `
      <span class="focus-place">${escapeHTML(getPlaceName(t.placeId))}</span>
      <span class="focus-title">${escapeHTML(t.title || "(Sin título)")}</span>
      <span class="focus-meta">${escapeHTML(
        [
          typeLabel(t.type),
          isOverdue(t) ? `vencida ${t.dueDate}` : (t.dueDate ? `vence ${t.dueDate}` : "sin fecha"),
          `lleva ${humanAge(taskAgeDays(t))}`
        ].join(" • ")
      )}</span>
    `;
    info.addEventListener("click", () => openModal(getTask(t.id)));

    const act = document.createElement("button");
    act.type = "button";
    act.className = "pill ok focus-do";
    act.textContent = t.status === "doing" ? "✅" : "▶";
    act.title = t.status === "doing" ? "Marcar como hecho" : "Empezar esto";
    act.addEventListener("click", () => setStatus(t.id, nextStatus(t.status)));

    row.appendChild(info);
    row.appendChild(act);
    frag.appendChild(row);
  }

  focusList.appendChild(frag);
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
    if (onlyStalled?.checked) parts.push(`solo estancadas (+${STALE_DAYS}d)`);
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

  // Título, badges, notas, meta y acciones van como hijos directos de la
  // tarjeta (no anidados) para que el grid pueda reacomodarlos: la vista
  // compacta necesita poner badges y botones en la misma fila.
  const head = document.createElement("div");
  head.className = "card-title";

  const h3 = document.createElement("h3");
  h3.textContent = t.title || "(Sin título)";
  head.appendChild(h3);

  const badgesBox = document.createElement("div");
  badgesBox.className = "badges";

  // Primero lo que cambia y urge; al final lo estructural.
  // Los valores por defecto (categoría "General", prioridad "Media") no se
  // muestran: salían en casi todas las tarjetas sin decir nada.
  badgesBox.appendChild(badge(statusLabel(t.status), t.status));

  if (t.dueDate) {
    badgesBox.appendChild(badge(
      isOverdue(t) ? `Venció: ${t.dueDate}` : `Vence: ${t.dueDate}`,
      isOverdue(t) ? "overdue" : "muted"
    ));
  }
  if (isDueSoon(t, 7) && !isOverdue(t)) {
    badgesBox.appendChild(badge("Pronto", "muted"));
  }

  const level = stallLevel(t);
  if (level > 0) {
    const age = humanAge(taskAgeDays(t));
    badgesBox.appendChild(badge(
      level === 3 ? `⏳ Lleva ${age} aquí` : `⏳ Lleva ${age}`,
      `stale stale-${level}`
    ));
  }

  if (clampInt(t.priority, 1, 3, 2) !== 2) {
    badgesBox.appendChild(badge(priorityLabel(t.priority), `pri-${t.priority}`));
  }

  badgesBox.appendChild(badge(getPlaceName(t.placeId), "muted"));

  // "is-structural": describe la tarea, no su urgencia. La vista compacta
  // los esconde para que los badges quepan en una sola línea.
  badgesBox.appendChild(badge(typeLabel(t.type), "muted is-structural"));

  const category = t.category || "General";
  if (category !== "General") {
    badgesBox.appendChild(badge(category, "muted is-structural"));
  }

  if (parseCost(t.cost) > 0) {
    badgesBox.appendChild(badge(formatCOP(t.cost), "muted is-structural"));
  }
  if (t.recurring?.enabled) {
    badgesBox.appendChild(badge(`Recurrente ${t.recurring.everyDays}d`, "recurring is-structural"));
  }

  card.appendChild(head);
  card.appendChild(badgesBox);

  if (t.notes) {
    const notes = document.createElement("div");
    notes.className = "card-notes";
    notes.textContent = t.notes;
    card.appendChild(notes);
  }

  // La fecha límite y la antigüedad ya salen como badge; aquí no se repiten.
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `Actualizado: ${formatDate(t.updatedAt || t.createdAt)}`;
  card.appendChild(meta);

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

  card.appendChild(right);

  return card;
}

function render() {
  ensureDefaultFilterValues();
  renderViewMode();
  renderStats();
  renderFocus();

  if (!list || !empty) return;

  const scopeTasks = getScopeTasks();
  const items = sortTasksList(scopeTasks.filter(taskMatchesFilters));

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
      "actualizado",
      "dias_de_antiguedad",
      "estancada"
    ]
  ];

  const tasks = sortTasksList(getScopeTasks().filter(taskMatchesFilters));

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
      t.updatedAt || "",
      taskAgeDays(t),
      isStalled(t) ? "sí" : "no"
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
      <div class="stat"><div class="stat-num">${s.stalled}</div><div class="stat-lbl">Estancadas</div></div>
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

  const scopeTasksForStats = getScopeTasks();
  const scopeStats = computeStatsFromTasks(scopeTasksForStats);
  const globalStats = scopeId === "all" ? scopeStats : computeStats("all");

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

  const oldestList = sortTasksList(scopeTasksForStats.filter(isStalled), "stalled_desc")
    .slice(0, 8);

  const oldestHTML = oldestList.length
    ? oldestList.map((t) => `
        <span class="badge stale stale-${stallLevel(t)}">
          ${escapeHTML(t.title || "(Sin título)")} · ${escapeHTML(humanAge(taskAgeDays(t)))}
        </span>
      `).join("")
    : `<span class="badge muted">Nada estancado 🎉</span>`;

  body.innerHTML = `
    ${statsCardsHTML(scopeStats)}

    <div class="card" style="margin:0 0 12px; grid-template-columns:1fr;">
      <div class="meta" style="margin-top:0;">Lo que lleva más tiempo esperando</div>
      <div class="badges" style="margin-top:8px;">
        ${oldestHTML}
      </div>
    </div>

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
          <span class="badge muted">Global estancadas: ${globalStats.stalled}</span>
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
/* Atajos del manifest: ./?action=new y ./?action=settings.
   Se limpia la URL para que recargar no vuelva a abrir el modal. */
function handleLaunchAction() {
  const action = new URLSearchParams(location.search).get("action");
  if (!action) return;

  if (action === "new") openModal(null);
  else if (action === "settings") openSettings();

  if (window.history?.replaceState) {
    history.replaceState(null, "", location.pathname);
  }
}

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

[
  placeSelect,
  statusFilter,
  typeFilter,
  priorityFilter,
  categoryFilter,
  sortBy,
  onlyOverdue,
  onlyRecurring,
  onlyStalled
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
handleLaunchAction();
registerPWA();
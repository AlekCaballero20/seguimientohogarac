/* Hogares | Musicala
   PWA + LocalStorage CRUD + filtros + export/import + recurrentes
   + Menú ⋯ (details) + Stats + Settings (config listas)
   Mantiene LS_KEY y estructura base para no romper instalaciones existentes.
*/

const LS_KEY = "hogares_pwa_v1";

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

function nowISO() { return new Date().toISOString(); }

function uid() {
  // UUID-ish rápido y suficiente para local
  return "t_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

function clampInt(n, min, max, fallback) {
  const x = Number.parseInt(n, 10);
  if (Number.isNaN(x)) return fallback;
  return Math.max(min, Math.min(max, x));
}

function safeJSONParse(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("es-CO", {
      year:"numeric", month:"short", day:"2-digit",
      hour:"2-digit", minute:"2-digit"
    });
  } catch { return ""; }
}

function formatCOP(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return "";
  return num.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0
  });
}

function addDays(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
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

function debounce(fn, wait=120) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

/* =========================
   State load/save + migration
========================= */
function makeInitState() {
  return {
    version: 1,
    places: DEFAULT_PLACES.map(p => ({...p})),
    categories: DEFAULT_CATEGORIES.slice(),
    tasks: []
  };
}

function normalizeState(st) {
  const init = makeInitState();
  const out = (st && typeof st === "object") ? st : init;

  // Backfill bases
  if (!Array.isArray(out.places) || out.places.length === 0) out.places = init.places;
  if (!Array.isArray(out.categories) || out.categories.length === 0) out.categories = init.categories;
  if (!Array.isArray(out.tasks)) out.tasks = [];

  // Normalize places
  out.places = out.places
    .filter(p => p && typeof p === "object" && p.id && p.name)
    .map(p => ({ id: String(p.id), name: String(p.name) }));

  if (out.places.length === 0) out.places = init.places;

  // Normalize categories (strings, unique, keep order)
  const seen = new Set();
  out.categories = out.categories
    .map(c => String(c || "").trim())
    .filter(c => c)
    .filter(c => (seen.has(c) ? false : (seen.add(c), true)));

  if (out.categories.length === 0) out.categories = init.categories;

  // Normalize tasks
  out.tasks = out.tasks
    .filter(t => t && typeof t === "object")
    .map(t => ({
      id: String(t.id || uid()),
      title: String(t.title || "").trim(),
      notes: String(t.notes || ""),
      placeId: String(t.placeId || out.places[0]?.id || "musicala"),
      type: t.type || "reponer",
      category: String(t.category || "General"),
      priority: clampInt(t.priority, 1, 3, 2),
      status: t.status || "todo",
      dueDate: t.dueDate || "",
      cost: sanitizeCost(t.cost),
      recurring: normalizeRecurring(t.recurring),
      createdAt: t.createdAt || nowISO(),
      updatedAt: t.updatedAt || t.createdAt || nowISO()
    }));

  out.version = 1;
  return out;
}

function normalizeRecurring(r) {
  const enabled = !!(r && r.enabled);
  const everyDays = clampInt(r?.everyDays, 1, 365, 30);
  return { enabled, everyDays };
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

  // Si hubo correcciones, las guardamos (sin borrar nada útil)
  localStorage.setItem(LS_KEY, JSON.stringify(normalized));
  return normalized;
}

function saveState(st) {
  localStorage.setItem(LS_KEY, JSON.stringify(st));
}

let state = loadState();

/* =========================
   UI refs (safe)
========================= */
const placeSelect     = $("#placeSelect");
const statusFilter    = $("#statusFilter");
const typeFilter      = $("#typeFilter");
const priorityFilter  = $("#priorityFilter");
const categoryFilter  = $("#categoryFilter");
const q               = $("#q");

const list            = $("#list");
const empty           = $("#empty");

const statTotal       = $("#statTotal");
const statTodo        = $("#statTodo");
const statDoing       = $("#statDoing");
const statDone        = $("#statDone");

const btnNew          = $("#btnNew");
const btnExport       = $("#btnExport");
const importFile      = $("#importFile");
const btnSeed         = $("#btnSeed"); // (ya no existe, pero lo soportamos)
const btnStats        = $("#btnStats");
const btnSettings     = $("#btnSettings");
const moreMenu        = $("#moreMenu"); // details

// Modal refs (tarea)
const modal           = $("#taskModal");
const form            = $("#taskForm");
const modalTitle      = $("#modalTitle");
const btnClose        = $("#btnClose");
const btnCancel       = $("#btnCancel");
const btnDelete       = $("#btnDelete");

const taskId          = $("#taskId");
const titleIn         = $("#title");
const notesIn         = $("#notes");
const placeIn         = $("#place");
const typeIn          = $("#type");
const categoryIn      = $("#category");
const priorityIn      = $("#priority");
const statusIn        = $("#status");
const dueDateIn       = $("#dueDate");
const costIn          = $("#cost");
const recurringIn     = $("#recurring");
const everyDaysIn     = $("#everyDays");
const nextHintIn      = $("#nextHint");

/* =========================
   Selects (places/categories)
========================= */
function fillPlacesSelect(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  state.places.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    selectEl.appendChild(opt);
  });
}

function fillCategoriesSelect(selectEl, includeAll=false) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  if (includeAll) {
    const optAll = document.createElement("option");
    optAll.value = "all";
    optAll.textContent = "Todas";
    selectEl.appendChild(optAll);
  }
  state.categories.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    selectEl.appendChild(opt);
  });
}

function ensureDefaultFilterValues() {
  if (placeSelect && !placeSelect.value) placeSelect.value = state.places[0]?.id ?? "musicala";
  if (categoryFilter && !categoryFilter.value) categoryFilter.value = "all";
}

function hydrateUI() {
  fillPlacesSelect(placeSelect);
  fillPlacesSelect(placeIn);

  fillCategoriesSelect(categoryFilter, true);
  fillCategoriesSelect(categoryIn, false);

  if (placeSelect) placeSelect.value = placeSelect.value || (state.places[0]?.id ?? "musicala");
  if (categoryFilter) categoryFilter.value = categoryFilter.value || "all";
}

/* =========================
   Modal: new/edit task
========================= */
function computeNextHint(dueDate, everyDays, recurringEnabled) {
  if (!recurringEnabled) return "";
  const days = clampInt(everyDays, 1, 365, 30);
  const base = dueDate || new Date().toISOString().slice(0,10);
  const next = addDays(base, days);
  return next ? `Próxima: ${next}` : "";
}

function updateRecurringUI() {
  if (!recurringIn || !everyDaysIn || !nextHintIn || !dueDateIn) return;
  const enabled = recurringIn.checked;
  everyDaysIn.disabled = !enabled;
  nextHintIn.value = computeNextHint(dueDateIn.value, everyDaysIn.value, enabled);
}

function openModal(editTask=null) {
  if (!modal || !form) return;

  const isEdit = !!editTask;
  if (modalTitle) modalTitle.textContent = isEdit ? "Editar tarea" : "Nueva tarea";
  if (btnDelete) btnDelete.hidden = !isEdit;

  const placeDefault = (placeSelect?.value || state.places[0]?.id || "musicala");

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
    everyDaysIn.value = 30;
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

/* =========================
   Filtering + rendering
========================= */
function getPlaceName(id) {
  return state.places.find(p => p.id === id)?.name ?? id;
}

function taskMatchesFilters(t) {
  const place = placeSelect?.value;
  const st = statusFilter?.value || "all";
  const ty = typeFilter?.value || "all";
  const pr = priorityFilter?.value || "all";
  const cat = categoryFilter?.value || "all";
  const query = (q?.value || "").trim().toLowerCase();

  if (place && t.placeId !== place) return false;
  if (st !== "all" && t.status !== st) return false;
  if (ty !== "all" && t.type !== ty) return false;
  if (pr !== "all" && String(t.priority) !== String(pr)) return false;
  if (cat !== "all" && (t.category || "General") !== cat) return false;

  if (query) {
    const hay = `${t.title || ""} ${t.notes || ""} ${(t.category || "")}`.toLowerCase();
    if (!hay.includes(query)) return false;
  }
  return true;
}

function sortTasks(a,b) {
  // Pending/Doing first, Done last. Then priority desc. Then updatedAt desc.
  const order = { todo: 0, doing: 1, done: 2 };
  const oa = order[a.status] ?? 9;
  const ob = order[b.status] ?? 9;
  if (oa !== ob) return oa - ob;

  const pa = Number(a.priority ?? 2);
  const pb = Number(b.priority ?? 2);
  if (pa !== pb) return pb - pa;

  const ua = Date.parse(a.updatedAt ?? a.createdAt ?? 0) || 0;
  const ub = Date.parse(b.updatedAt ?? b.createdAt ?? 0) || 0;
  return ub - ua;
}

function badge(text, cls="") {
  const span = document.createElement("span");
  span.className = `badge ${cls}`.trim();
  span.textContent = text;
  return span;
}

function typeLabel(t) {
  return ({ reparar:"Arreglar", comprar:"Comprar", reponer:"Reponer", mejorar:"Mejorar" }[t] || t);
}
function statusLabel(s) {
  return ({ todo:"Pendiente", doing:"En proceso", done:"Hecho" }[s] || s);
}
function priorityLabel(p) {
  return ({ 3:"Alta", 2:"Media", 1:"Baja" }[Number(p)] || "Media");
}

function renderStats() {
  if (!statTotal || !statTodo || !statDoing || !statDone || !placeSelect) return;

  const all = state.tasks.filter(t => t.placeId === placeSelect.value);
  const todo = all.filter(t => t.status === "todo").length;
  const doing = all.filter(t => t.status === "doing").length;
  const done = all.filter(t => t.status === "done").length;

  statTotal.textContent = String(all.length);
  statTodo.textContent = String(todo);
  statDoing.textContent = String(doing);
  statDone.textContent = String(done);
}

function render() {
  ensureDefaultFilterValues();
  renderStats();

  if (!list || !empty) return;

  const items = state.tasks
    .filter(taskMatchesFilters)
    .slice()
    .sort(sortTasks);

  list.innerHTML = "";
  empty.hidden = items.length !== 0;

  const frag = document.createDocumentFragment();

  for (const t of items) {
    const card = document.createElement("div");
    card.className = "card";

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

    if (t.dueDate) badgesBox.appendChild(badge(`Vence: ${t.dueDate}`, "muted"));
    if (t.cost && Number(t.cost) > 0) badgesBox.appendChild(badge(formatCOP(t.cost), "muted"));
    if (t.recurring?.enabled) badgesBox.appendChild(badge(`Recurrente ${t.recurring.everyDays}d`, "muted"));

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
    meta.textContent = `Actualizado: ${formatDate(t.updatedAt || t.createdAt)}`;
    left.appendChild(meta);

    const right = document.createElement("div");
    right.className = "actions";

    const btnDone = document.createElement("button");
    btnDone.className = "pill ok";
    btnDone.type = "button";
    btnDone.textContent = "✅";
    btnDone.title = "Marcar como hecho";
    btnDone.addEventListener("click", () => setStatus(t.id, "done"));

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

    right.appendChild(btnDone);
    right.appendChild(btnEdit);
    right.appendChild(btnTrash);

    card.appendChild(left);
    card.appendChild(right);

    frag.appendChild(card);
  }

  list.appendChild(frag);
}

/* =========================
   CRUD
========================= */
function getTask(id) {
  return state.tasks.find(t => t.id === id) || null;
}

function upsertTask(task) {
  const idx = state.tasks.findIndex(t => t.id === task.id);
  if (idx >= 0) state.tasks[idx] = task;
  else state.tasks.push(task);

  saveState(state);
  render();
}

function deleteTask(id) {
  const t = getTask(id);
  if (!t) return;

  const ok = confirm(`¿Eliminar: "${t.title}"?`);
  if (!ok) return;

  state.tasks = state.tasks.filter(x => x.id !== id);
  saveState(state);
  render();
}

function setStatus(id, status) {
  const t = getTask(id);
  if (!t) return;

  const wasDone = t.status === "done";
  t.status = status;
  t.updatedAt = nowISO();

  upsertTask(t);

  if (!wasDone && status === "done" && t.recurring?.enabled) {
    createNextRecurring(t);
  }
}

function createNextRecurring(task) {
  const everyDays = clampInt(task.recurring?.everyDays, 1, 365, 30);
  const base = task.dueDate || new Date().toISOString().slice(0,10);
  const nextDue = addDays(base, everyDays);

  const next = {
    ...task,
    id: uid(),
    status: "todo",
    createdAt: nowISO(),
    updatedAt: nowISO(),
    dueDate: nextDue || "",
    // keep recurring enabled
  };

  // anti-duplicados
  const dup = state.tasks.some(t =>
    (t.title || "").trim().toLowerCase() === (next.title || "").trim().toLowerCase() &&
    t.placeId === next.placeId &&
    t.type === next.type &&
    (t.dueDate || "") === (next.dueDate || "") &&
    t.status !== "done"
  );

  if (!dup) {
    state.tasks.push(next);
    saveState(state);
    render();
  }
}

/* =========================
   Export / Import
========================= */
function exportJSON() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `hogares_backup_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function importJSONFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const incomingRaw = safeJSONParse(String(reader.result || "{}"), null);
      if (!incomingRaw || typeof incomingRaw !== "object") throw new Error("JSON inválido");

      // Normalizamos lo importado (sin confiar en nada)
      const incoming = normalizeState(incomingRaw);

      // Estrategia simple: reemplazar todo
      state = incoming;

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
   Seed templates (opcional)
========================= */
function seedTemplates() {
  const place = placeSelect?.value || state.places[0]?.id || "musicala";

  const templates = [
    { title: "Reponer shampoo", type:"reponer", category:"Baño", priority:2 },
    { title: "Comprar papel higiénico", type:"reponer", category:"Baño", priority:2, recurring:{enabled:true, everyDays:21} },
    { title: "Revisar bombillos", type:"mejorar", category:"General", priority:1, recurring:{enabled:true, everyDays:60} },
    { title: "Arreglar / pintar pared", type:"reparar", category:"General", priority:3 },
    { title: "Comprar extensiones/cables", type:"comprar", category:"Herramientas", priority:2 },
    { title: "Arena / comida mascotas", type:"reponer", category:"Mascotas", priority:2, recurring:{enabled:true, everyDays:15} },
    { title: "Limpieza profunda cocina", type:"mejorar", category:"Cocina", priority:1, recurring:{enabled:true, everyDays:30} }
  ];

  const created = templates.map(tpl => ({
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
    recurring: tpl.recurring?.enabled ? { enabled:true, everyDays: tpl.recurring.everyDays } : { enabled:false, everyDays: 30 },
    createdAt: nowISO(),
    updatedAt: nowISO()
  }));

  const addable = created.filter(n =>
    !state.tasks.some(t =>
      t.placeId === n.placeId &&
      (t.title || "").trim().toLowerCase() === n.title.trim().toLowerCase() &&
      t.status !== "done"
    )
  );

  if (addable.length === 0) {
    alert("Ya tienes estas plantillas (o algo muy parecido). No voy a duplicar el caos. 😌");
    return;
  }

  state.tasks.push(...addable);
  saveState(state);
  render();
}

/* =========================
   Task form
========================= */
function sanitizeCost(v) {
  if (v === null || v === undefined || v === "") return "";
  const cleaned = String(v).replace(/[^\d]/g, "");
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num <= 0) return "";
  return num;
}

function readFormTask(existing=null) {
  const id = taskId.value || uid();
  const title = (titleIn.value || "").trim();
  const notes = (notesIn.value || "").trim();
  const placeId = placeIn.value;
  const type = typeIn.value;
  const category = (categoryIn.value || "General");
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
    recurring: recurringEnabled ? { enabled:true, everyDays } : { enabled:false, everyDays },
    createdAt: base.createdAt || nowISO(),
    updatedAt: nowISO()
  };
}

/* =========================
   Menu ⋯ behavior (details)
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
   Stats modal (dynamic)
========================= */
let statsDialog = null;

function computeStats(placeId) {
  const tasks = state.tasks.filter(t => t.placeId === placeId);
  const todo = tasks.filter(t => t.status === "todo");
  const doing = tasks.filter(t => t.status === "doing");
  const done = tasks.filter(t => t.status === "done");

  const totalCost = tasks.reduce((acc, t) => acc + (Number(t.cost) || 0), 0);

  const now = new Date();
  const overdue = tasks.filter(t => t.status !== "done" && t.dueDate && new Date(t.dueDate) < now).length;

  const recurring = tasks.filter(t => t.recurring?.enabled).length;

  // Top categorías
  const catCount = new Map();
  for (const t of tasks) {
    const c = t.category || "General";
    catCount.set(c, (catCount.get(c) || 0) + 1);
  }
  const topCats = Array.from(catCount.entries())
    .sort((a,b) => b[1]-a[1])
    .slice(0, 6);

  // Top tipos
  const typeCount = new Map();
  for (const t of tasks) {
    const ty = typeLabel(t.type);
    typeCount.set(ty, (typeCount.get(ty) || 0) + 1);
  }
  const topTypes = Array.from(typeCount.entries())
    .sort((a,b) => b[1]-a[1])
    .slice(0, 4);

  return {
    tasksCount: tasks.length,
    todo: todo.length,
    doing: doing.length,
    done: done.length,
    overdue,
    recurring,
    totalCost,
    topCats,
    topTypes
  };
}

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
          <div class="modal-sub" id="statsSub">Resumen por lugar</div>
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

function openStats() {
  if (!placeSelect) return;
  const dlg = ensureStatsDialog();

  const placeId = placeSelect.value;
  const placeName = getPlaceName(placeId);
  const s = computeStats(placeId);

  const body = dlg.querySelector("#statsBody");
  const sub = dlg.querySelector("#statsSub");

  sub.textContent = `Lugar: ${placeName}`;

  body.innerHTML = `
    <div class="stats" style="padding:0; margin-bottom:12px;">
      <div class="stat"><div class="stat-num">${s.tasksCount}</div><div class="stat-lbl">Total</div></div>
      <div class="stat"><div class="stat-num">${s.todo}</div><div class="stat-lbl">Pendientes</div></div>
      <div class="stat"><div class="stat-num">${s.doing}</div><div class="stat-lbl">En proceso</div></div>
      <div class="stat"><div class="stat-num">${s.done}</div><div class="stat-lbl">Hechos</div></div>
    </div>

    <div class="card" style="margin:0; grid-template-columns: 1fr;">
      <div class="badges" style="margin-bottom:8px;">
        <span class="badge muted">Vencidas: ${s.overdue}</span>
        <span class="badge muted">Recurrentes: ${s.recurring}</span>
        <span class="badge muted">Costo total: ${escapeHTML(formatCOP(s.totalCost) || "$0")}</span>
      </div>

      <div class="meta" style="margin-top:0;">Top categorías</div>
      <div class="badges" style="margin-top:6px;">
        ${s.topCats.length ? s.topCats.map(([c,n]) => `<span class="badge muted">${escapeHTML(c)} · ${n}</span>`).join("") : `<span class="badge muted">Sin datos</span>`}
      </div>

      <div class="meta" style="margin-top:12px;">Top tipos</div>
      <div class="badges" style="margin-top:6px;">
        ${s.topTypes.length ? s.topTypes.map(([t,n]) => `<span class="badge muted">${escapeHTML(t)} · ${n}</span>`).join("") : `<span class="badge muted">Sin datos</span>`}
      </div>
    </div>
  `;

  dlg.showModal();
}

/* =========================
   Settings modal (config lists)
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
          <div class="modal-sub">Configura lugares y categorías (sin romper nada).</div>
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
              Nota: No te dejo borrar un lugar/categoría si está en uso. Porque después lloran. 🫠
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
  return state.tasks.some(t => t.placeId === placeId);
}

function isCategoryUsed(cat) {
  return state.tasks.some(t => (t.category || "General") === cat);
}

function addPlace(name) {
  const id = slugId(name);
  if (state.places.some(p => p.id === id)) {
    alert("Ese lugar ya existe (ID repetido). Cámbiale un poquito el nombre. 😅");
    return;
  }
  state.places.push({ id, name });
  saveState(state);
  hydrateUI();
  render();
}

function renamePlace(id, newName) {
  const p = state.places.find(x => x.id === id);
  if (!p) return;
  p.name = newName.trim() || p.name;
  saveState(state);
  hydrateUI();
  render();
}

function deletePlace(id) {
  if (isPlaceUsed(id)) {
    alert("No puedo borrar ese lugar porque ya tiene tareas. Mueve/borra tareas primero.");
    return;
  }
  state.places = state.places.filter(p => p.id !== id);
  if (state.places.length === 0) state.places = DEFAULT_PLACES.map(p => ({...p}));
  saveState(state);
  hydrateUI();
  render();
}

function addCategory(name) {
  const c = name.trim();
  if (!c) return;
  if (state.categories.includes(c)) {
    alert("Esa categoría ya existe. Sí, incluso si la miras con mala cara.");
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
  // actualizar lista
  state.categories = state.categories.map(c => (c === oldName ? nn : c));
  // actualizar tareas
  state.tasks = state.tasks.map(t => ({
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
    alert("No puedo borrar esa categoría porque ya está en uso. Cambia esas tareas primero.");
    return;
  }
  state.categories = state.categories.filter(c => c !== name);
  if (state.categories.length === 0) state.categories = DEFAULT_CATEGORIES.slice();
  saveState(state);
  hydrateUI();
  render();
}

function renderSettingsLists() {
  const dlg = ensureSettingsDialog();

  const placesWrap = dlg.querySelector("#placesList");
  const catsWrap = dlg.querySelector("#catsList");

  // Places
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

  // Categories
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
    // silent
  });
}

/* =========================
   Events wiring (safe)
========================= */
function safeOn(el, evt, fn) {
  if (!el) return;
  el.addEventListener(evt, fn);
}

safeOn(btnNew, "click", () => openModal(null));
safeOn(btnExport, "click", () => exportJSON());

safeOn(importFile, "change", (e) => {
  const file = e.target.files?.[0];
  if (file) importJSONFile(file);
});

if (btnSeed) safeOn(btnSeed, "click", () => seedTemplates()); // si revive, funciona

safeOn(btnStats, "click", () => openStats());
safeOn(btnSettings, "click", () => openSettings());

safeOn(btnClose, "click", () => closeModal());
safeOn(btnCancel, "click", () => closeModal());

[placeSelect, statusFilter, typeFilter, priorityFilter, categoryFilter].forEach(el => {
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

/* Keyboard shortcuts */
document.addEventListener("keydown", (e) => {
  // Ctrl/Cmd + N => new
  if (e.key.toLowerCase() === "n" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    openModal(null);
  }
});

/* Menu close wiring */
wireMenuClose();

/* =========================
   Boot
========================= */
hydrateUI();
render();
registerPWA();
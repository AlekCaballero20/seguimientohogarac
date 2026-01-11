/* Hogares | Musicala
   PWA + LocalStorage CRUD + filtros + export/import + recurrentes
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

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function nowISO() { return new Date().toISOString(); }
function uid() {
  // Simple UUID-ish
  return "t_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}
function clampInt(n, min, max, fallback) {
  const x = Number.parseInt(n, 10);
  if (Number.isNaN(x)) return fallback;
  return Math.max(min, Math.min(max, x));
}
function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString("es-CO", { year:"numeric", month:"short", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  } catch { return ""; }
}
function formatCOP(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return "";
  return num.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
}
function addDays(dateStr, days) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}

function loadState() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) {
    const init = {
      version: 1,
      places: DEFAULT_PLACES,
      categories: DEFAULT_CATEGORIES,
      tasks: []
    };
    localStorage.setItem(LS_KEY, JSON.stringify(init));
    return init;
  }
  try {
    const st = JSON.parse(raw);
    // Backfill
    if (!Array.isArray(st.places) || st.places.length === 0) st.places = DEFAULT_PLACES;
    if (!Array.isArray(st.categories) || st.categories.length === 0) st.categories = DEFAULT_CATEGORIES;
    if (!Array.isArray(st.tasks)) st.tasks = [];
    return st;
  } catch {
    // If corrupted, reset
    const init = {
      version: 1,
      places: DEFAULT_PLACES,
      categories: DEFAULT_CATEGORIES,
      tasks: []
    };
    localStorage.setItem(LS_KEY, JSON.stringify(init));
    return init;
  }
}
function saveState(st) {
  localStorage.setItem(LS_KEY, JSON.stringify(st));
}

let state = loadState();

// UI refs
const placeSelect = $("#placeSelect");
const statusFilter = $("#statusFilter");
const typeFilter = $("#typeFilter");
const priorityFilter = $("#priorityFilter");
const categoryFilter = $("#categoryFilter");
const q = $("#q");

const list = $("#list");
const empty = $("#empty");

const statTotal = $("#statTotal");
const statTodo = $("#statTodo");
const statDoing = $("#statDoing");
const statDone = $("#statDone");

const btnNew = $("#btnNew");
const btnExport = $("#btnExport");
const importFile = $("#importFile");
const btnSeed = $("#btnSeed");

// Modal refs
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

// Populate selects
function fillPlacesSelect(selectEl) {
  selectEl.innerHTML = "";
  state.places.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    selectEl.appendChild(opt);
  });
}
function fillCategoriesSelect(selectEl, includeAll=false) {
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
  if (!placeSelect.value) placeSelect.value = state.places[0]?.id ?? "musicala";
  if (!categoryFilter.value) categoryFilter.value = "all";
}

function openModal(editTask=null) {
  const isEdit = !!editTask;
  modalTitle.textContent = isEdit ? "Editar tarea" : "Nueva tarea";
  btnDelete.hidden = !isEdit;

  if (!isEdit) {
    taskId.value = "";
    titleIn.value = "";
    notesIn.value = "";
    placeIn.value = placeSelect.value || state.places[0].id;
    typeIn.value = "reponer";
    categoryIn.value = "General";
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
    placeIn.value = editTask.placeId ?? state.places[0].id;
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
  titleIn.focus();
}

function closeModal() {
  if (modal.open) modal.close();
}

function computeNextHint(dueDate, everyDays, recurringEnabled) {
  if (!recurringEnabled) return "";
  const days = clampInt(everyDays, 1, 365, 30);
  const base = dueDate || new Date().toISOString().slice(0,10);
  const next = addDays(base, days);
  return next ? `Próxima: ${next}` : "";
}

function updateRecurringUI() {
  const enabled = recurringIn.checked;
  everyDaysIn.disabled = !enabled;
  nextHintIn.value = computeNextHint(dueDateIn.value, everyDaysIn.value, enabled);
}

// Filtering + rendering
function getPlaceName(id) {
  return state.places.find(p => p.id === id)?.name ?? id;
}
function taskMatchesFilters(t) {
  const place = placeSelect.value;
  const st = statusFilter.value;
  const ty = typeFilter.value;
  const pr = priorityFilter.value;
  const cat = categoryFilter.value;
  const query = (q.value || "").trim().toLowerCase();

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

function renderStats() {
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

  const items = state.tasks
    .filter(taskMatchesFilters)
    .slice()
    .sort(sortTasks);

  list.innerHTML = "";

  empty.hidden = items.length !== 0;

  for (const t of items) {
    const card = document.createElement("div");
    card.className = "card";

    const left = document.createElement("div");

    const head = document.createElement("div");
    head.className = "card-title";

    const h3 = document.createElement("h3");
    h3.textContent = t.title || "(Sin título)";
    head.appendChild(h3);

    const badges = document.createElement("div");
    badges.className = "badges";

    badges.appendChild(badge(getPlaceName(t.placeId), "muted"));
    badges.appendChild(badge(typeLabel(t.type), "muted"));
    badges.appendChild(badge(t.category || "General", "muted"));
    badges.appendChild(badge(priorityLabel(t.priority), `pri-${t.priority || 2}`));
    badges.appendChild(badge(statusLabel(t.status), t.status));

    if (t.dueDate) {
      badges.appendChild(badge(`Vence: ${t.dueDate}`, "muted"));
    }
    if (t.cost && Number(t.cost) > 0) {
      badges.appendChild(badge(formatCOP(t.cost), "muted"));
    }
    if (t.recurring?.enabled) {
      badges.appendChild(badge(`Recurrente ${t.recurring.everyDays}d`, "muted"));
    }

    head.appendChild(badges);
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
    btnDone.textContent = "✅";
    btnDone.title = "Marcar como hecho";
    btnDone.addEventListener("click", () => setStatus(t.id, "done"));

    const btnEdit = document.createElement("button");
    btnEdit.className = "pill edit";
    btnEdit.textContent = "✏️";
    btnEdit.title = "Editar";
    btnEdit.addEventListener("click", () => openModal(getTask(t.id)));

    const btnTrash = document.createElement("button");
    btnTrash.className = "pill trash";
    btnTrash.textContent = "🗑️";
    btnTrash.title = "Eliminar";
    btnTrash.addEventListener("click", () => deleteTask(t.id));

    right.appendChild(btnDone);
    right.appendChild(btnEdit);
    right.appendChild(btnTrash);

    card.appendChild(left);
    card.appendChild(right);

    list.appendChild(card);
  }
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

// CRUD
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

  // If marking done and recurring enabled: generate next occurrence
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
  // base date: dueDate if exists, else today
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

  // Avoid duplicates if somehow created twice quickly
  const dup = state.tasks.some(t =>
    t.title === next.title &&
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

// Export/Import
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
      const incoming = JSON.parse(String(reader.result || "{}"));

      if (!incoming || typeof incoming !== "object") throw new Error("JSON inválido");
      if (!Array.isArray(incoming.tasks)) incoming.tasks = [];
      if (!Array.isArray(incoming.places) || incoming.places.length === 0) incoming.places = state.places;
      if (!Array.isArray(incoming.categories) || incoming.categories.length === 0) incoming.categories = state.categories;

      // Merge strategy: replace entire state (simple + predictable)
      state = {
        version: 1,
        places: incoming.places,
        categories: incoming.categories,
        tasks: incoming.tasks
      };

      saveState(state);
      hydrateUI();
      render();
      alert("Importación lista ✅");
    } catch (e) {
      alert("No pude importar ese archivo. Puede estar dañado o no ser de esta app.");
    } finally {
      importFile.value = "";
    }
  };
  reader.readAsText(file);
}

// Quick templates / seed
function seedTemplates() {
  const place = placeSelect.value || state.places[0].id;

  const templates = [
    { title: "Reponer shampoo", type:"reponer", category:"Baño", priority:2 },
    { title: "Comprar papel higiénico", type:"reponer", category:"Baño", priority:2, recurring:{enabled:true, everyDays:21} },
    { title: "Revisar bombillos", type:"mejorar", category:"General", priority:1, recurring:{enabled:true, everyDays:60} },
    { title: "Arreglar / pintar pared", type:"reparar", category:"General", priority:3 },
    { title: "Comprar extensiones/cables", type:"comprar", category:"Herramientas", priority:2 },
    { title: "Arena / comida mascotas", type:"reponer", category:"Mascotas", priority:2, recurring:{enabled:true, everyDays:15} },
    { title: "Limpieza profunda cocina", type:"mejorar", category:"Cocina", priority:1, recurring:{enabled:true, everyDays:30} }
  ];

  const created = [];
  for (const tpl of templates) {
    created.push({
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
    });
  }

  // Only add those that aren't already pending/doing for same title + place
  const addable = created.filter(n =>
    !state.tasks.some(t => t.placeId === n.placeId && (t.title || "").toLowerCase() === n.title.toLowerCase() && t.status !== "done")
  );

  if (addable.length === 0) {
    alert("Ya tienes estas plantillas (o algo muy parecido). No voy a duplicar el caos. 😌");
    return;
  }

  state.tasks.push(...addable);
  saveState(state);
  render();
}

// Modal form handling
function readFormTask(existing=null) {
  const id = taskId.value || uid();
  const title = (titleIn.value || "").trim();
  const notes = (notesIn.value || "").trim();
  const placeId = placeIn.value;
  const type = typeIn.value;
  const category = categoryIn.value || "General";
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
function sanitizeCost(v) {
  if (!v) return "";
  const cleaned = String(v).replace(/[^\d]/g, "");
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num <= 0) return "";
  return num;
}

// UI wiring
function hydrateUI() {
  fillPlacesSelect(placeSelect);
  fillPlacesSelect(placeIn);

  fillCategoriesSelect(categoryFilter, true);
  fillCategoriesSelect(categoryIn, false);

  // Defaults
  placeSelect.value = state.places[0]?.id ?? "musicala";
  categoryFilter.value = "all";
}

function registerPWA() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // silent: offline still works without SW, just no install caching
    });
  }
}

// Events
btnNew.addEventListener("click", () => openModal(null));
btnExport.addEventListener("click", exportJSON);

importFile.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) importJSONFile(file);
});

btnSeed.addEventListener("click", () => seedTemplates());

btnClose.addEventListener("click", closeModal);
btnCancel.addEventListener("click", closeModal);

[placeSelect, statusFilter, typeFilter, priorityFilter, categoryFilter].forEach(el => {
  el.addEventListener("change", render);
});
q.addEventListener("input", () => render());

recurringIn.addEventListener("change", updateRecurringUI);
everyDaysIn.addEventListener("input", updateRecurringUI);
dueDateIn.addEventListener("change", updateRecurringUI);

form.addEventListener("submit", (e) => {
  e.preventDefault();

  const id = taskId.value;
  const existing = id ? getTask(id) : null;

  const t = readFormTask(existing);
  if (!t.title) {
    alert("Ponle un título, por lo menos. 🙃");
    return;
  }

  upsertTask(t);
  closeModal();
});

btnDelete.addEventListener("click", () => {
  const id = taskId.value;
  if (!id) return;
  closeModal();
  deleteTask(id);
});

// Tap card actions already wired in render, but edit also needs delete button show
list.addEventListener("click", () => { /* no-op; explicit per button */ });

// First boot
hydrateUI();
render();
registerPWA();

// Bonus: keyboard shortcut "n"
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "n" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    openModal(null);
  }
});

(function () {
  const $ = (id) => document.getElementById(id);
  const state = { data: null, selected: null, busy: {} };

  const EXT_TYPES = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif", webp: "image/webp" };

  // ---------- Utilidades ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const pad = (n) => String(n).padStart(2, "0");
  const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
  const fmtDate = (d) => new Date(d).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  let toastTimer;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-on"), 3500);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, { credentials: "same-origin", ...opts });
    let body = null;
    try { body = await res.json(); } catch {}
    if (res.status === 401 && path !== "/api/login") { showLogin(); throw new Error("Sesión expirada."); }
    if (!res.ok) throw new Error((body && body.error) || "Algo salió mal.");
    return body;
  }

  // ---------- Vistas ----------
  function showLogin() {
    $("app").hidden = true;
    $("login").hidden = false;
    $("pin").value = "";
    setTimeout(() => $("pin").focus(), 50);
  }

  async function load() {
    try {
      const data = await fetch("/api/status", { credentials: "same-origin" });
      if (data.status === 401) return showLogin();
      const body = await data.json();
      if (!data.ok) throw new Error(body.error);
      state.data = body;
      $("login").hidden = true;
      $("app").hidden = false;
      render();
    } catch (e) {
      showLogin();
      $("login-error").textContent = e.message || "No se pudo conectar.";
    }
  }

  async function refresh() {
    try { state.data = await api("/api/status"); render(); } catch (e) { toast(e.message); }
  }

  function required() { return state.data.documents.filter((d) => d.required); }
  function hasFile(m, d) { return !!(state.data.files[m] && state.data.files[m][d]); }
  function memberDone(m) { return required().filter((d) => hasFile(m, d.id)).length; }

  function render() {
    const { data } = state;
    const isAdmin = data.role === "admin";
    const req = required();
    const total = req.length * data.members.length;
    const received = data.members.reduce((s, m) => s + memberDone(m.id), 0);
    const complete = data.members.filter((m) => memberDone(m.id) === req.length).length;

    $("max-mb").textContent = Math.round(data.maxFileBytes / 1048576);
    $("stat-docs").textContent = received;
    $("stat-docs-total").textContent = total;
    $("stat-members").textContent = complete;
    $("stat-members-total").textContent = data.members.length;
    $("stat-pending").textContent = total - received;

    $("role-badge").hidden = !isAdmin;
    $("admin-btn").hidden = isAdmin;
    $("band-member").hidden = isAdmin;
    $("band-admin").hidden = !isAdmin;

    if (!state.selected || !data.members.find((m) => m.id === state.selected)) {
      state.selected = store.get("member") || data.members[0].id;
      if (!data.members.find((m) => m.id === state.selected)) state.selected = data.members[0].id;
    }

    // Tabs
    $("tabs").innerHTML = data.members.map((m) => {
      const done = memberDone(m.id);
      const sel = m.id === state.selected;
      return `<button class="tab" role="tab" type="button" id="tab-${m.id}" aria-selected="${sel}" data-member="${m.id}" tabindex="${sel ? 0 : -1}">
        <span>${esc(m.name)}</span>
        <span class="tab__count ${done === req.length ? "is-done" : ""}">${done}/${req.length}</span>
      </button>`;
    }).join("");

    renderPanel();

    // Panel admin
    if (isAdmin) {
      const missing = data.members.map((m) => ({ m, n: req.length - memberDone(m.id) })).filter((x) => x.n > 0);
      const anyFile = Object.keys(data.files).length > 0;
      if (!missing.length) {
        $("admin-title").textContent = "Expediente completo.";
        $("admin-text").textContent = "Los seis socios ya subieron todos sus documentos obligatorios. Descarga el ZIP organizado por carpetas.";
        $("zip-btn").textContent = "Descargar ZIP ↓";
      } else {
        $("admin-title").textContent = "Expediente incompleto.";
        $("admin-text").textContent = "Faltan: " + missing.map((x) => `${x.m.name} (${x.n})`).join(", ") + ". Puedes descargar lo que hay; el ZIP incluye un índice con lo pendiente.";
        $("zip-btn").textContent = "Descargar lo que hay ↓";
      }
      $("zip-btn").disabled = !anyFile;
      $("wipe-btn").disabled = !anyFile;
    }
  }

  function renderPanel() {
    const { data } = state;
    const m = data.members.find((x) => x.id === state.selected);
    const isAdmin = data.role === "admin";
    const req = required();
    const done = memberDone(m.id);

    const rows = data.documents.map((d) => {
      const f = data.files[m.id] && data.files[m.id][d.id];
      const busy = state.busy[`${m.id}/${d.id}`];
      const badge = f
        ? `<span class="badge badge--ok">Recibido</span>`
        : d.required ? `<span class="badge badge--pending">Pendiente</span>` : `<span class="badge badge--optional">Opcional</span>`;
      const meta = f
        ? `${esc(f.originalName || "archivo")} · ${fmtSize(f.size)} · ${fmtDate(f.uploaded)}`
        : esc(d.hint);
      const inputId = `in-${m.id}-${d.id}`;
      const actions = busy
        ? `<span class="label muted">Subiendo…</span>`
        : f
          ? `${isAdmin ? `<a class="btn btn--ghost" href="/api/files/${m.id}/${d.id}?inline" target="_blank" rel="noopener">Ver</a>` : ""}
             <label class="btn btn--ghost" for="${inputId}">Reemplazar</label>
             <button class="btn btn--ghost" type="button" data-delete="${d.id}">Quitar</button>`
          : `<label class="btn btn--primary" for="${inputId}">Subir ↑</label>`;
      return `<div class="doc" data-doc="${d.id}">
        <div class="doc__main">
          <div class="doc__title"><span class="doc__name">${esc(d.name)}</span>${badge}</div>
          <div class="doc__meta" title="${meta}">${meta}</div>
        </div>
        <div class="doc__actions">
          ${actions}
          <input id="${inputId}" type="file" accept="application/pdf,image/*" hidden data-upload="${d.id}">
        </div>
        <div class="doc__progress" id="prog-${m.id}-${d.id}"></div>
      </div>`;
    }).join("");

    $("doc-panel").setAttribute("aria-labelledby", `tab-${m.id}`);
    $("doc-panel").innerHTML = `
      <div class="doc-panel__head">
        <span class="subheading">${esc(m.name)}</span>
        <span class="label muted">${done} de ${req.length} obligatorios${done === req.length ? " · completo ✓" : ""}</span>
      </div>${rows}`;
  }

  // ---------- Subida ----------
  function fileType(file) {
    if (file.type && Object.values(EXT_TYPES).includes(file.type)) return file.type;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    return EXT_TYPES[ext] || "";
  }

  function upload(memberId, docId, file) {
    const type = fileType(file);
    if (!type) return toast("Formato no permitido. Sube PDF, JPG, PNG, HEIC o WEBP.");
    if (file.size > state.data.maxFileBytes) return toast(`El archivo pesa más de ${Math.round(state.data.maxFileBytes / 1048576)} MB.`);
    if (!file.size) return toast("El archivo está vacío.");

    const key = `${memberId}/${docId}`;
    state.busy[key] = true;
    renderPanel();

    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/files/${memberId}/${docId}`);
    xhr.setRequestHeader("Content-Type", type);
    xhr.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => {
      const bar = $(`prog-${memberId}-${docId}`);
      if (bar && e.lengthComputable) bar.style.width = (e.loaded / e.total) * 100 + "%";
    };
    xhr.onload = () => {
      delete state.busy[key];
      if (xhr.status === 401) return showLogin();
      if (xhr.status >= 200 && xhr.status < 300) {
        toast("Documento recibido.");
      } else {
        let msg = "No se pudo subir el archivo.";
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
        toast(msg);
      }
      refresh();
    };
    xhr.onerror = () => { delete state.busy[key]; toast("Error de conexión. Intenta de nuevo."); renderPanel(); };
    xhr.send(file);
  }

  async function removeFile(memberId, docId) {
    const doc = state.data.documents.find((d) => d.id === docId);
    if (!confirm(`¿Quitar “${doc.name}”? Tendrás que volver a subirlo.`)) return;
    try {
      await api(`/api/files/${memberId}/${docId}`, { method: "DELETE" });
      toast("Archivo eliminado.");
      refresh();
    } catch (e) { toast(e.message); }
  }

  // ---------- ZIP ----------
  async function downloadZip() {
    const { data } = state;
    const btn = $("zip-btn");
    const bar = $("zip-progress");
    const jobs = [];
    data.members.forEach((m, mi) => {
      data.documents.forEach((d, di) => {
        const f = data.files[m.id] && data.files[m.id][d.id];
        if (f) jobs.push({ m, d, f, folder: `${pad(mi + 1)}_${slug(m.name)}`, file: `${pad(di + 1)}_${slug(d.name)}.${f.ext || "bin"}` });
      });
    });
    if (!jobs.length) return;

    btn.disabled = true;
    const label = btn.textContent;
    const files = [];
    try {
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        btn.textContent = `Preparando ${i + 1}/${jobs.length}…`;
        const res = await fetch(`/api/files/${j.m.id}/${j.d.id}`, { credentials: "same-origin" });
        if (!res.ok) throw new Error(`No se pudo descargar ${j.m.name}: ${j.d.name}.`);
        files.push({ path: `${data.zipRoot}/${j.folder}/${j.file}`, data: new Uint8Array(await res.arrayBuffer()), date: new Date(j.f.uploaded) });
        bar.style.width = ((i + 1) / jobs.length) * 100 + "%";
      }

      // Índice del expediente
      const lines = [`Expediente para el acta constitutiva de ${data.org}`, `Generado: ${new Date().toLocaleString("es-MX")}`, ""];
      data.members.forEach((m, mi) => {
        lines.push(`${pad(mi + 1)}_${slug(m.name)}  (${m.name})`);
        data.documents.forEach((d) => {
          const has = hasFile(m.id, d.id);
          lines.push(`  [${has ? "x" : " "}] ${d.name}${d.required ? "" : " (opcional)"}${!has && d.required ? "  <- PENDIENTE" : ""}`);
        });
        lines.push("");
      });
      files.unshift({ path: `${data.zipRoot}/00_INDICE.txt`, data: new TextEncoder().encode(lines.join("\r\n")) });

      const blob = window.MiniZip.buildZip(files);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${data.zipRoot}_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      toast("ZIP descargado.");
    } catch (e) {
      toast(e.message || "No se pudo generar el ZIP.");
    } finally {
      btn.disabled = false;
      btn.textContent = label;
      setTimeout(() => (bar.style.width = "0"), 1500);
    }
  }

  async function wipeAll() {
    const answer = prompt("Esto borra TODOS los documentos del servidor y no se puede deshacer.\nEscribe BORRAR para confirmar.");
    if (answer !== "BORRAR") return;
    try {
      const r = await api("/api/wipe", { method: "POST" });
      toast(`Se borraron ${r.deleted} archivos.`);
      refresh();
    } catch (e) { toast(e.message); }
  }

  // ---------- Eventos ----------
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("login-error").textContent = "";
    try {
      await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: $("pin").value }) });
      load();
    } catch (err) { $("login-error").textContent = err.message; $("pin").select(); }
  });

  function openAdmin() {
    $("admin-error").textContent = "";
    $("admin-pin").value = "";
    $("admin-dialog").showModal();
  }
  $("admin-btn").addEventListener("click", openAdmin);
  $("band-admin-btn").addEventListener("click", openAdmin);
  $("admin-cancel").addEventListener("click", () => $("admin-dialog").close());
  $("admin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: $("admin-pin").value, admin: true }) });
      $("admin-dialog").close();
      toast("Modo administrador activo.");
      refresh();
    } catch (err) { $("admin-error").textContent = err.message; $("admin-pin").select(); }
  });

  $("logout-btn").addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
    showLogin();
  });

  $("tabs").addEventListener("click", (e) => {
    const t = e.target.closest("[data-member]");
    if (!t) return;
    state.selected = t.dataset.member;
    store.set("member", state.selected);
    render();
    $(`tab-${state.selected}`).focus();
  });
  $("tabs").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const ids = state.data.members.map((m) => m.id);
    let i = ids.indexOf(state.selected) + (e.key === "ArrowRight" ? 1 : -1);
    i = (i + ids.length) % ids.length;
    state.selected = ids[i];
    store.set("member", state.selected);
    render();
    $(`tab-${state.selected}`).focus();
  });

  const panel = $("doc-panel");
  panel.addEventListener("change", (e) => {
    const input = e.target.closest("[data-upload]");
    if (input && input.files[0]) upload(state.selected, input.dataset.upload, input.files[0]);
  });
  panel.addEventListener("click", (e) => {
    const del = e.target.closest("[data-delete]");
    if (del) removeFile(state.selected, del.dataset.delete);
  });
  panel.addEventListener("dragover", (e) => {
    const row = e.target.closest(".doc");
    if (!row) return;
    e.preventDefault();
    panel.querySelectorAll(".is-drag").forEach((r) => r !== row && r.classList.remove("is-drag"));
    row.classList.add("is-drag");
  });
  panel.addEventListener("dragleave", (e) => {
    const row = e.target.closest(".doc");
    if (row && !row.contains(e.relatedTarget)) row.classList.remove("is-drag");
  });
  panel.addEventListener("drop", (e) => {
    const row = e.target.closest(".doc");
    if (!row) return;
    e.preventDefault();
    row.classList.remove("is-drag");
    const file = e.dataTransfer.files[0];
    if (file && !state.busy[`${state.selected}/${row.dataset.doc}`]) upload(state.selected, row.dataset.doc, file);
  });

  $("zip-btn").addEventListener("click", downloadZip);
  $("wipe-btn").addEventListener("click", wipeAll);

  window.addEventListener("scroll", () => {
    document.querySelector(".nav").classList.toggle("is-scrolled", window.scrollY > 4);
  }, { passive: true });

  load();
})();

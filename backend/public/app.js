"use strict";

/*
 * Cliente de HorarioComún. Sin frameworks.
 * Se sirve desde el mismo backend, así que la API es del mismo origen.
 * Si servís el frontend aparte (ej. GitHub Pages), definí la URL del backend con:
 *   localStorage.setItem("horariocomun_api", "https://tu-backend.example.com")
 */
const API_BASE = (localStorage.getItem("horariocomun_api") || "").replace(/\/+$/, "");
const POLL_MS = 4000;
const MAX_BYTES = 8 * 1024 * 1024;
const MIMES_OK = ["image/jpeg", "image/png", "image/webp"];

const NOMBRE_DIA = {
  lunes: "Lun",
  martes: "Mar",
  miercoles: "Mié",
  jueves: "Jue",
  viernes: "Vie",
  sabado: "Sáb",
  domingo: "Dom",
};

const state = { codigo: null, alias: null, timer: null };

const $ = (sel) => document.querySelector(sel);

// ── Helpers ─────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(API_BASE + path, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* respuesta sin cuerpo JSON */
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function normalizarCodigo(entrada) {
  return entrada.trim().toUpperCase().replace(/[\s-]/g, "");
}

function hhmmAMin(s) {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function minAHHMM(t) {
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function tiempoRelativo(iso) {
  const seg = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seg < 60) return "recién";
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  return `hace ${Math.floor(seg / 3600)} h`;
}

function mostrarPantalla(cual) {
  $("#pantalla-inicio").hidden = cual !== "inicio";
  $("#pantalla-sala").hidden = cual !== "sala";
}

function errorInicio(msg) {
  const el = $("#error-inicio");
  el.textContent = msg;
  el.hidden = !msg;
}

function errorSubida(msg) {
  const el = $("#error-subida");
  el.textContent = msg;
  el.hidden = !msg;
}

// ── Sesión (para sobrevivir a un refresh) ───────────────────────────
function guardarSesion() {
  try {
    sessionStorage.setItem(
      "horariocomun_sesion",
      JSON.stringify({ codigo: state.codigo, alias: state.alias }),
    );
  } catch {
    /* modo privado, etc. */
  }
}

function cargarSesion() {
  try {
    return JSON.parse(sessionStorage.getItem("horariocomun_sesion") || "null");
  } catch {
    return null;
  }
}

function limpiarSesion() {
  try {
    sessionStorage.removeItem("horariocomun_sesion");
  } catch {
    /* noop */
  }
}

// ── Entrar / salir de una sala ─────────────────────────────────────
async function entrarSala(codigo, { silencioso = false } = {}) {
  codigo = normalizarCodigo(codigo);
  if (!codigo) return;
  try {
    const estado = await api(`/api/salas/${codigo}`);
    state.codigo = codigo;
    const ses = cargarSesion();
    state.alias = ses && ses.codigo === codigo ? ses.alias : null;
    guardarSesion();

    errorInicio("");
    mostrarPantalla("sala");
    history.replaceState(null, "", `?sala=${codigo}`);
    render(estado);
    iniciarPolling();
  } catch (err) {
    limpiarSesion();
    history.replaceState(null, "", location.pathname);
    if (!silencioso) {
      errorInicio(
        err.status === 404
          ? "No encontramos esa sala. Revisá el código (o quizás ya expiró)."
          : err.message,
      );
    }
  }
}

function salir() {
  detenerPolling();
  limpiarSesion();
  state.codigo = null;
  state.alias = null;
  history.replaceState(null, "", location.pathname);
  mostrarPantalla("inicio");
}

// ── Polling ────────────────────────────────────────────────────────
function iniciarPolling() {
  detenerPolling();
  state.timer = setInterval(refrescar, POLL_MS);
}

function detenerPolling() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

async function refrescar() {
  if (!state.codigo) return;
  try {
    const estado = await api(`/api/salas/${state.codigo}`);
    render(estado);
  } catch (err) {
    if (err.status === 404) {
      alert("La sala expiró o dejó de existir.");
      salir();
    }
  }
}

// ── Render ─────────────────────────────────────────────────────────
function render(estado) {
  $("#sala-codigo").textContent = estado.codigo;

  const participantes = estado.participantes || [];
  $("#conteo").textContent = String(participantes.length);

  const yo = (state.alias || "").trim().toLowerCase();
  const lista = $("#lista-participantes");
  if (participantes.length === 0) {
    lista.innerHTML = '<li class="muted">Todavía no subió nadie.</li>';
  } else {
    lista.innerHTML = participantes
      .map((p) => {
        const esYo = p.alias.trim().toLowerCase() === yo;
        return `<li>
          <span class="${esYo ? "yo" : ""}">${escapar(p.alias)}${esYo ? " (vos)" : ""}</span>
          <span class="muted">${tiempoRelativo(p.subidoEn)}</span>
        </li>`;
      })
      .join("");
  }

  // Si ya subiste, adaptá el formulario.
  const yaSubi = participantes.some((p) => p.alias.trim().toLowerCase() === yo && yo);
  const btn = $("#btn-subir");
  if (yaSubi) {
    btn.textContent = "Actualizar mi horario";
    if (!$("#input-alias").value) $("#input-alias").value = state.alias;
  } else {
    btn.textContent = "Subir horario";
  }

  renderGrilla(estado.grilla);
}

function renderGrilla(grilla) {
  const aviso = $("#aviso-grilla");
  const { config, dias } = grilla;
  const n = grilla.participantes.length;

  const hayHueco = config.dias.some((d) => (dias[d] || []).length > 0);
  if (n === 0) {
    aviso.textContent = "Cuando la gente suba su horario, acá vas a ver los huecos en común.";
  } else if (!grilla.suficientesParticipantes) {
    aviso.textContent = "Falta al menos una persona más para cruzar horarios (esto muestra tus propios huecos por ahora).";
  } else if (!hayHueco) {
    aviso.textContent = `Las ${n} personas no comparten ningún hueco libre en el rango ${config.rangoInicio}–${config.rangoFin}. 😕`;
  } else {
    aviso.textContent = `Bloques donde las ${n} personas están libres (${config.rangoInicio}–${config.rangoFin}, cada ${config.granularidadMin} min).`;
  }

  const inicio = hhmmAMin(config.rangoInicio);
  const fin = hhmmAMin(config.rangoFin);
  const paso = config.granularidadMin;
  const listaDias = config.dias;

  const libres = {};
  for (const d of listaDias) {
    libres[d] = (dias[d] || []).map((b) => [hhmmAMin(b.inicio), hhmmAMin(b.fin)]);
  }

  let html = "<thead><tr><th class='hora'></th>";
  for (const d of listaDias) html += `<th>${NOMBRE_DIA[d] || d}</th>`;
  html += "</tr></thead><tbody>";

  for (let s = inicio; s + paso <= fin; s += paso) {
    const enPunto = s % 60 === 0;
    html += `<tr class="${enPunto ? "enpunto" : ""}"><th class="hora">${minAHHMM(s)}</th>`;
    for (const d of listaDias) {
      const libre = libres[d].some(([a, b]) => s >= a && s + paso <= b);
      html += `<td class="${libre ? "libre" : ""}"></td>`;
    }
    html += "</tr>";
  }
  html += "</tbody>";
  $("#grilla").innerHTML = html;
}

function escapar(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

// ── Eventos ────────────────────────────────────────────────────────
$("#btn-crear").addEventListener("click", async () => {
  errorInicio("");
  $("#btn-crear").disabled = true;
  try {
    const r = await api("/api/salas", { method: "POST" });
    await entrarSala(r.codigo);
  } catch (err) {
    errorInicio(err.message);
  } finally {
    $("#btn-crear").disabled = false;
  }
});

$("#form-unirse").addEventListener("submit", (e) => {
  e.preventDefault();
  entrarSala($("#input-codigo").value);
});

$("#btn-salir").addEventListener("click", salir);

$("#btn-copiar").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?sala=${state.codigo}`;
  const btn = $("#btn-copiar");
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = "¡Copiado!";
  } catch {
    window.prompt("Copiá el link de la sala:", url);
    return;
  }
  setTimeout(() => (btn.textContent = original), 1500);
});

$("#form-horario").addEventListener("submit", async (e) => {
  e.preventDefault();
  errorSubida("");
  const alias = $("#input-alias").value.trim();
  const file = $("#input-imagen").files[0];

  if (!alias) return errorSubida("Poné un alias.");
  if (!file) return errorSubida("Elegí una imagen de tu horario.");
  if (!MIMES_OK.includes(file.type)) {
    return errorSubida("Formato no soportado. Usá JPG, PNG o WEBP.");
  }
  if (file.size > MAX_BYTES) {
    return errorSubida("La imagen pesa más de 8 MB. Probá con una más liviana.");
  }

  const fd = new FormData();
  fd.append("alias", alias);
  fd.append("imagen", file);

  const btn = $("#btn-subir");
  const estado = $("#estado-subida");
  btn.disabled = true;
  estado.hidden = false;
  estado.textContent = "Leyendo tu horario con el modelo de visión… puede tardar unos segundos.";

  try {
    const r = await api(`/api/salas/${state.codigo}/horarios`, { method: "POST", body: fd });
    state.alias = r.alias;
    guardarSesion();
    estado.textContent = "¡Listo! Tu horario quedó cargado.";
    $("#input-imagen").value = "";
    render(r.sala);
  } catch (err) {
    estado.hidden = true;
    errorSubida(err.message);
  } finally {
    btn.disabled = false;
  }
});

// ── Arranque ───────────────────────────────────────────────────────
(function init() {
  const params = new URLSearchParams(location.search);
  const salaURL = params.get("sala");
  const ses = cargarSesion();

  if (salaURL) {
    entrarSala(salaURL);
  } else if (ses && ses.codigo) {
    entrarSala(ses.codigo, { silencioso: true });
  } else {
    mostrarPantalla("inicio");
  }
})();

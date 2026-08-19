// entulínea ProPoints — app personal, estática, localStorage
// Reglas y fórmulas: ver /data/alimentos.json -> meta, e investigación en el repo del proyecto.

const STORAGE_KEY = "entulinea_propoints_v1";
const CAPITAL_DIARIO_PP = 29; // fijado — usuaria: 168cm/90kg/44a, fórmula verificada
const EXTRA_SEMANAL_PP = 49;

let ALIMENTOS = [];
let state = null;
let franjaSeleccionada = "desayuno";

// ---------- Utilidades de fecha ----------
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function mondayOfWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=domingo..6=sabado
  const diff = day === 0 ? -6 : 1 - day; // retrocede hasta el lunes
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

// ---------- Estado persistente ----------
function defaultState() {
  return {
    dias: {},            // fecha -> { modalidad, registros: [...] }
    semanas: {},         // lunes -> { reservas: [...] }
    pesos: [],           // [{fecha, kg}]
    alimentosPersonalizados: [] // mismos campos que ALIMENTOS
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch (e) {
    console.error("Error leyendo localStorage, reiniciando estado.", e);
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getDia(fecha) {
  if (!state.dias[fecha]) {
    state.dias[fecha] = { modalidad: "contar", registros: [] };
  }
  return state.dias[fecha];
}

function getSemana(lunes) {
  if (!state.semanas[lunes]) {
    state.semanas[lunes] = { reservas: [] };
  }
  return state.semanas[lunes];
}

// ---------- Cálculo de saldos ----------
function ppConsumidosCapital(fecha) {
  const dia = getDia(fecha);
  return dia.registros
    .filter(r => r.origen_descuento === "capital_diario" || r.origen_descuento === "capital_diario+extra_semanal")
    .reduce((sum, r) => sum + (r.origen_descuento === "capital_diario+extra_semanal" ? r.pp_desde_capital : r.pp), 0);
}

function ppConsumidosExtraEnFecha(fecha) {
  const dia = getDia(fecha);
  return dia.registros
    .filter(r => r.origen_descuento === "extra_semanal" || r.origen_descuento === "capital_diario+extra_semanal")
    .reduce((sum, r) => sum + (r.origen_descuento === "extra_semanal" ? r.pp : r.pp_desde_extra), 0);
}

function ppConsumidosExtraEnSemana(lunes) {
  let total = 0;
  for (const fecha of Object.keys(state.dias)) {
    if (mondayOfWeek(fecha) === lunes) {
      total += ppConsumidosExtraEnFecha(fecha);
    }
  }
  const semana = getSemana(lunes);
  total += semana.reservas.reduce((s, r) => s + r.pp, 0);
  return total;
}

function capitalRestante(fecha) {
  return CAPITAL_DIARIO_PP - ppConsumidosCapital(fecha);
}

function extraRestante(lunes) {
  return EXTRA_SEMANAL_PP - ppConsumidosExtraEnSemana(lunes);
}

const FRANJAS = ["desayuno", "comida", "cena", "snack"];
const FRANJA_LABEL = { desayuno: "Desayuno", comida: "Comida", cena: "Cena", snack: "Snack" };

// ---------- Lógica de añadir alimento (según esquema_tecnico.md) ----------
function registrarAlimento(fecha, alimento, franja) {
  const dia = getDia(fecha);
  const modalidad = dia.modalidad;
  const pp = alimento.pp ?? 0;
  let registro = {
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    nombre: alimento.nombre,
    racion: alimento.racion || "",
    pp,
    saciante_dnc: !!alimento.saciante_dnc,
    franja: FRANJAS.includes(franja) ? franja : "snack",
    hora: new Date().toISOString()
  };

  if (modalidad === "dnc" && alimento.saciante_dnc) {
    registro.origen_descuento = "ninguno";
    registro.pp_efectivo = 0;
  } else if (modalidad === "dnc" && !alimento.saciante_dnc) {
    registro.origen_descuento = "extra_semanal";
    registro.pp_efectivo = pp;
  } else {
    // modalidad "contar": capital primero, extra despues
    const capRest = capitalRestante(fecha);
    if (capRest >= pp) {
      registro.origen_descuento = "capital_diario";
      registro.pp_efectivo = pp;
    } else if (capRest > 0) {
      registro.origen_descuento = "capital_diario+extra_semanal";
      registro.pp_desde_capital = capRest;
      registro.pp_desde_extra = pp - capRest;
      registro.pp_efectivo = pp;
    } else {
      registro.origen_descuento = "extra_semanal";
      registro.pp_efectivo = pp;
    }
  }

  dia.registros.push(registro);
  saveState();
}

function borrarRegistro(fecha, id) {
  const dia = getDia(fecha);
  dia.registros = dia.registros.filter(r => r.id !== id);
  saveState();
}

// ---------- Fórmula calculadora manual ----------
function calcularPP(proteina, carbo, grasa, fibra) {
  const val = (proteina / 10) + (carbo / 10) + (grasa / 4) + (fibra / 30);
  return Math.round(val);
}

// ---------- OCR de etiqueta nutricional (Tesseract.js, cliente) ----------
// Nunca rellena y guarda directo: solo escribe en los campos editables de la
// calculadora, que la usuaria revisa y corrige antes de "Añadir al día".
function parsearEtiquetaNutricional(texto) {
  const t = texto.toLowerCase().replace(/,/g, ".");

  function buscarValor(patrones) {
    for (const patron of patrones) {
      const m = t.match(patron);
      if (m) {
        const num = parseFloat(m[1]);
        if (!isNaN(num)) return num;
      }
    }
    return null;
  }
  // número tolerante a errores típicos de OCR: dígitos, punto opcional, con
  // "g" u "og"/"gr" pegado o separado detrás.
  const num = "(\\d+(?:\\.\\d+)?)\\s*(?:g|gr)?";

  return {
    proteina: buscarValor([
      new RegExp("prote[ií]nas?[^\\d]{0,15}" + num),
    ]),
    carbo: buscarValor([
      new RegExp("hidratos de carbono[^\\d]{0,15}" + num),
      new RegExp("carbohidratos[^\\d]{0,15}" + num),
      new RegExp("hidratos[^\\d]{0,15}" + num),
    ]),
    grasa: buscarValor([
      // "grasas totales" / "grasas" seguido del número, siempre que las
      // primeras ~20 letras después del número no sean "saturad..." (evita
      // capturar la fila de "de las cuales saturadas" como si fuera el total).
      new RegExp("grasas?\\s*totales?[^\\d]{0,15}" + num + "(?![^a-z]{0,20}saturad)"),
      new RegExp("grasas?(?!\\s*saturad)[^\\d]{0,15}" + num + "(?![^a-z]{0,20}saturad)"),
    ]),
    fibra: buscarValor([
      new RegExp("fibra(?:\\s*aliment\\w*)?[^\\d]{0,15}" + num),
    ]),
  };
}

async function ocrEtiqueta(file) {
  const statusEl = document.getElementById("ocr-status");
  statusEl.classList.remove("hidden", "error", "done");
  statusEl.classList.add("working");
  statusEl.textContent = "Leyendo etiqueta...";

  try {
    if (typeof Tesseract === "undefined") {
      throw new Error("El lector de imágenes no se pudo cargar (revisa tu conexión).");
    }
    const { data } = await Tesseract.recognize(file, "spa");
    const valores = parsearEtiquetaNutricional(data.text);

    let encontrados = 0;
    if (valores.proteina !== null) { document.getElementById("calc-proteina").value = valores.proteina; encontrados++; }
    if (valores.carbo !== null) { document.getElementById("calc-carbo").value = valores.carbo; encontrados++; }
    if (valores.grasa !== null) { document.getElementById("calc-grasa").value = valores.grasa; encontrados++; }
    if (valores.fibra !== null) { document.getElementById("calc-fibra").value = valores.fibra; encontrados++; }
    actualizarCalculoManual();

    statusEl.classList.remove("working");
    if (encontrados === 0) {
      statusEl.classList.add("error");
      statusEl.textContent = "No se ha podido leer ningún valor. Escríbelos a mano.";
    } else if (encontrados < 4) {
      statusEl.classList.add("error");
      statusEl.textContent = `Se han rellenado ${encontrados} de 4 valores. Revisa y completa el resto a mano.`;
    } else {
      statusEl.classList.add("done");
      statusEl.textContent = "Valores leídos — revísalos antes de añadir.";
    }
  } catch (err) {
    console.error(err);
    statusEl.classList.remove("working");
    statusEl.classList.add("error");
    statusEl.textContent = "No se ha podido leer la foto. Escribe los valores a mano.";
  }
}

// ---------- Carga de alimentos ----------
async function cargarAlimentos() {
  const res = await fetch("data/alimentos.json");
  const db = await res.json();
  ALIMENTOS = db.alimentos;
}

function todosLosAlimentos() {
  return [...ALIMENTOS, ...state.alimentosPersonalizados];
}

const STOPWORDS = new Set(["de", "del", "la", "el", "los", "las", "y", "o", "con", "sin", "un", "una"]);

function quitarAcentos(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function categoriasDisponibles() {
  return [...new Set(todosLosAlimentos().map(a => a.categoria).filter(Boolean))].sort();
}

// query / categoria / ppMax son todos opcionales y se combinan (AND). Sin
// ningún filtro activo no se muestra nada, para no listar los 750 de golpe.
function buscarAlimentos(query, categoria, ppMax) {
  const palabras = quitarAcentos((query || "").trim().toLowerCase()).split(/\s+/).filter(p => p && !STOPWORDS.has(p));
  const hayTexto = palabras.length > 0;
  const hayCategoria = !!categoria;
  const hayPpMax = ppMax !== null && ppMax !== undefined && ppMax !== "" && !isNaN(ppMax);

  if (!hayTexto && !hayCategoria && !hayPpMax) return [];

  const resultados = todosLosAlimentos()
    .filter(a => {
      if (hayTexto) {
        // Muchos nombres de la BD histórica vienen "recortados" porque en la
        // fuente original la categoría hacía de encabezado (ej. bajo "Quesos"
        // -> "Manchego curado", sin la palabra "queso"). Se busca en nombre +
        // categoría a la vez, y sin distinguir acentos.
        const texto = quitarAcentos((a.nombre + " " + (a.categoria || "")).toLowerCase());
        if (!palabras.every(p => texto.includes(p))) return false;
      }
      if (hayCategoria && a.categoria !== categoria) return false;
      if (hayPpMax) {
        // Sin PP verificado (null): se incluye solo si es saciante (vale 0 en
        // DNC, así que siempre "cabe" en cualquier PP máximo >= 0).
        const pp = a.pp === null || a.pp === undefined ? (a.saciante_dnc ? 0 : Infinity) : a.pp;
        if (pp > Number(ppMax)) return false;
      }
      return true;
    })
    .sort((a, b) => (a.pp ?? 0) - (b.pp ?? 0));

  // El límite de 60 solo tiene sentido para acotar una búsqueda de texto libre
  // sin más filtros (podría matchear cientos de nombres parecidos). Con
  // categoría y/o PP máximo activos, el propio filtro ya acota el volumen que
  // el usuario quiere ver — cortar ahí ocultaba resultados reales (ej. "todas
  // las categorías, PP<=3" corta antes de llegar a ver nada por encima de 0).
  const filtrosAcotan = hayCategoria || hayPpMax;
  return filtrosAcotan ? resultados : resultados.slice(0, 60);
}

// ---------- Render: vista Hoy ----------
function renderHoy() {
  const fecha = todayStr();
  const dia = getDia(fecha);
  const lunes = mondayOfWeek(fecha);

  const capRest = capitalRestante(fecha);
  const extRest = extraRestante(lunes);

  document.getElementById("capital-total").textContent = CAPITAL_DIARIO_PP;
  const capEl = document.getElementById("capital-restante");
  capEl.textContent = capRest;
  capEl.classList.toggle("negative", capRest < 0);

  const extEl = document.getElementById("extra-restante");
  extEl.textContent = extRest;
  extEl.classList.toggle("negative", extRest < 0);

  document.querySelectorAll(".modo-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.modo === dia.modalidad);
  });

  const contenedor = document.getElementById("lista-dia-por-franja");
  const vacio = document.getElementById("lista-vacia");
  contenedor.innerHTML = "";

  if (dia.registros.length === 0) {
    vacio.style.display = "block";
    return;
  }
  vacio.style.display = "none";

  FRANJAS.forEach(franja => {
    const registrosFranja = dia.registros.filter(r => (r.franja || "snack") === franja);
    if (registrosFranja.length === 0) return;

    const totalFranja = registrosFranja.reduce((s, r) => s + r.pp_efectivo, 0);

    const grupo = document.createElement("div");
    grupo.className = "grupo-franja";
    grupo.innerHTML = `<h2>${FRANJA_LABEL[franja]} <span class="grupo-total">${totalFranja} PP</span></h2>`;

    const ul = document.createElement("ul");
    ul.className = "registros-list";

    registrosFranja.slice().reverse().forEach(r => {
      const li = document.createElement("li");
      li.className = "registro-item";
      const badge = r.saciante_dnc && r.origen_descuento === "ninguno"
        ? `<span class="badge dnc">DNC</span>`
        : "";
      const origenTexto = {
        "ninguno": "sin coste (DNC)",
        "extra_semanal": "del extra semanal",
        "capital_diario": "del capital diario",
        "capital_diario+extra_semanal": `capital + extra`
      }[r.origen_descuento] || "";
      const metaTexto = r.racion ? `${escapeHtml(r.racion)} · ${origenTexto}` : origenTexto;
      li.innerHTML = `
        <div class="registro-info">
          <span class="registro-nombre">${escapeHtml(r.nombre)} ${badge}</span>
          <span class="registro-meta">${metaTexto}</span>
        </div>
        <span class="registro-pp ${r.pp_efectivo === 0 ? "zero" : ""}">${r.pp_efectivo === 0 ? "0 PP" : r.pp + " PP"}</span>
        <button class="btn-del" data-id="${r.id}" aria-label="Eliminar">&times;</button>
      `;
      li.querySelector(".btn-del").addEventListener("click", () => {
        borrarRegistro(fecha, r.id);
        renderHoy();
      });
      ul.appendChild(li);
    });

    grupo.appendChild(ul);
    contenedor.appendChild(grupo);
  });
}

// ---------- Render: vista Extra ----------
function renderExtra() {
  const fecha = todayStr();
  const lunes = mondayOfWeek(fecha);
  const semana = getSemana(lunes);

  document.getElementById("semana-inicio").textContent = formatFechaCorta(lunes);
  const extEl = document.getElementById("extra-restante-2");
  const rest = extraRestante(lunes);
  extEl.textContent = rest;
  extEl.classList.toggle("negative", rest < 0);

  const lista = document.getElementById("lista-reservas");
  const vacio = document.getElementById("reservas-vacia");
  lista.innerHTML = "";
  if (semana.reservas.length === 0) {
    vacio.style.display = "block";
  } else {
    vacio.style.display = "none";
    semana.reservas.slice().reverse().forEach(r => {
      const li = document.createElement("li");
      li.className = "registro-item";
      li.innerHTML = `
        <div class="registro-info">
          <span class="registro-nombre">${escapeHtml(r.etiqueta)}</span>
          <span class="registro-meta">reservado</span>
        </div>
        <span class="registro-pp">${r.pp} PP</span>
        <button class="btn-del" data-id="${r.id}" aria-label="Eliminar">&times;</button>
      `;
      li.querySelector(".btn-del").addEventListener("click", () => {
        semana.reservas = semana.reservas.filter(x => x.id !== r.id);
        saveState();
        renderExtra();
      });
      lista.appendChild(li);
    });
  }
}

// ---------- Render: vista Peso ----------
function renderPeso() {
  const lista = document.getElementById("lista-peso");
  const vacio = document.getElementById("peso-vacio");
  const pesos = state.pesos.slice().sort((a, b) => a.fecha.localeCompare(b.fecha));

  lista.innerHTML = "";
  pesos.slice().reverse().forEach(p => {
    const li = document.createElement("li");
    li.className = "registro-item";
    li.innerHTML = `
      <div class="registro-info">
        <span class="registro-nombre">${p.kg} kg</span>
        <span class="registro-meta">${formatFechaCorta(p.fecha)}</span>
      </div>
      <button class="btn-del" data-fecha="${p.fecha}" aria-label="Eliminar">&times;</button>
    `;
    li.querySelector(".btn-del").addEventListener("click", () => {
      state.pesos = state.pesos.filter(x => x.fecha !== p.fecha);
      saveState();
      renderPeso();
    });
    lista.appendChild(li);
  });

  vacio.style.display = pesos.length === 0 ? "block" : "none";
  drawPesoChart(pesos);
}

function drawPesoChart(pesos) {
  const canvas = document.getElementById("peso-canvas");
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (pesos.length < 2) return;

  const pad = 30;
  const kgs = pesos.map(p => p.kg);
  const min = Math.min(...kgs) - 1;
  const max = Math.max(...kgs) + 1;
  const styles = getComputedStyle(document.body);
  const accent = styles.getPropertyValue("--accent").trim() || "#2f7d5f";
  const textMuted = styles.getPropertyValue("--text-muted").trim() || "#7a7268";

  function x(i) { return pad + (i / (pesos.length - 1)) * (w - pad * 2); }
  function y(kg) { return h - pad - ((kg - min) / (max - min || 1)) * (h - pad * 2); }

  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  pesos.forEach((p, i) => {
    const px = x(i), py = y(p.kg);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.stroke();

  ctx.fillStyle = accent;
  pesos.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(p.kg), 3.5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = textMuted;
  ctx.font = "11px sans-serif";
  ctx.fillText(max.toFixed(1) + " kg", 4, pad);
  ctx.fillText(min.toFixed(1) + " kg", 4, h - pad + 4);
}

// ---------- Render: histórico ----------
function renderHistorico() {
  const lista = document.getElementById("lista-historico");
  const vacio = document.getElementById("historico-vacio");
  const fechas = Object.keys(state.dias).sort().reverse();

  lista.innerHTML = "";
  if (fechas.length === 0) {
    vacio.style.display = "block";
    return;
  }
  vacio.style.display = "none";

  fechas.forEach(fecha => {
    const dia = state.dias[fecha];
    if (dia.registros.length === 0) return;
    const totalCapital = dia.registros
      .filter(r => r.origen_descuento === "capital_diario" || r.origen_descuento === "capital_diario+extra_semanal")
      .reduce((s, r) => s + (r.origen_descuento === "capital_diario+extra_semanal" ? r.pp_desde_capital : r.pp), 0);
    const totalExtra = dia.registros
      .filter(r => r.origen_descuento === "extra_semanal" || r.origen_descuento === "capital_diario+extra_semanal")
      .reduce((s, r) => s + (r.origen_descuento === "extra_semanal" ? r.pp : r.pp_desde_extra), 0);

    const porFranjaTexto = FRANJAS
      .map(f => {
        const n = dia.registros.filter(r => (r.franja || "snack") === f).length;
        return n > 0 ? `${FRANJA_LABEL[f]}: ${n}` : null;
      })
      .filter(Boolean)
      .join(" · ");

    const li = document.createElement("li");
    li.className = "historico-item";
    li.innerHTML = `
      <div class="historico-fecha">${formatFechaCorta(fecha)} — ${dia.modalidad === "dnc" ? "DNC" : "Contar todo"}</div>
      <div class="historico-resumen">
        <span>Capital: ${totalCapital} PP</span>
        <span>Extra: ${totalExtra} PP</span>
        <span>${dia.registros.length} alimento(s)</span>
      </div>
      ${porFranjaTexto ? `<div class="historico-resumen">${porFranjaTexto}</div>` : ""}
    `;
    lista.appendChild(li);
  });
}

// ---------- Helpers ----------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
function formatFechaCorta(fecha) {
  const d = new Date(fecha + "T00:00:00");
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

// ---------- Navegación de tabs ----------
function switchView(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("view-" + view).classList.add("active");
  document.querySelector(`.tab-btn[data-view="${view}"]`).classList.add("active");
  if (view === "hoy") renderHoy();
  if (view === "extra") renderExtra();
  if (view === "peso") renderPeso();
  if (view === "historico") renderHistorico();
}

// ---------- Modal añadir alimento ----------
function poblarFiltroCategoria() {
  const select = document.getElementById("filtro-categoria");
  const actual = select.value;
  select.innerHTML = '<option value="">Todas las categorías</option>';
  categoriasDisponibles().forEach(cat => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });
  select.value = actual;
}

function abrirModal() {
  document.getElementById("modal-alimento").classList.remove("hidden");
  document.getElementById("buscador-alimento").value = "";
  document.getElementById("filtro-categoria").value = "";
  document.getElementById("filtro-pp-max").value = "";
  document.getElementById("resultados-alimento").innerHTML = "";
  document.getElementById("calculadora-manual").classList.add("hidden");
  document.getElementById("ocr-status").classList.add("hidden");
  document.getElementById("calc-foto-etiqueta").value = "";
  poblarFiltroCategoria();
  franjaSeleccionada = "desayuno";
  document.querySelectorAll(".franja-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.franja === "desayuno");
  });
  document.getElementById("buscador-alimento").focus();
}
function cerrarModal() {
  document.getElementById("modal-alimento").classList.add("hidden");
}

function renderResultadosBusqueda() {
  const cont = document.getElementById("resultados-alimento");
  const query = document.getElementById("buscador-alimento").value;
  const categoria = document.getElementById("filtro-categoria").value;
  const ppMax = document.getElementById("filtro-pp-max").value;
  const resultados = buscarAlimentos(query, categoria, ppMax);
  cont.innerHTML = "";
  resultados.forEach(a => {
    const li = document.createElement("li");
    li.className = "resultado-item";
    const sinPpVerificado = a.pp === null || a.pp === undefined;
    const fecha = todayStr();
    const modalidadHoy = getDia(fecha).modalidad;
    // Sin PP verificado, "?? PP" solo es realmente un problema en modo "contar
    // todo": si el alimento es saciante y hoy es DNC, vale 0 sin duda, aunque
    // no sepamos su valor fuera de DNC.
    const sePuedeAnadirHoy = !sinPpVerificado || (a.saciante_dnc && modalidadHoy === "dnc");
    const ppTexto = sinPpVerificado
      ? (a.saciante_dnc && modalidadHoy === "dnc" ? "0 PP (DNC)" : "?? PP")
      : a.pp + " PP";
    const saciante = a.saciante_dnc ? `<span class="badge dnc">DNC</span>` : "";
    li.innerHTML = `
      <div class="registro-info">
        <span class="resultado-nombre">${escapeHtml(a.nombre)} ${saciante}</span>
        <span class="resultado-meta">${escapeHtml(a.categoria)} · ${escapeHtml(a.racion || "")}</span>
      </div>
      <span class="registro-pp">${ppTexto}</span>
    `;
    li.addEventListener("click", () => {
      if (!sePuedeAnadirHoy) {
        alert("Este alimento no tiene un valor ProPoints verificado fuera de DNC. Cambia a modo DNC (si es saciante) o usa la calculadora manual para asignarle un valor.");
        return;
      }
      registrarAlimento(fecha, a, franjaSeleccionada);
      cerrarModal();
      renderHoy();
    });
    cont.appendChild(li);
  });
}

function actualizarCalculoManual() {
  // Nutrientes introducidos por 100g (como en el etiquetado), escalados a los gramos reales de la ración.
  const p100 = parseFloat(document.getElementById("calc-proteina").value) || 0;
  const c100 = parseFloat(document.getElementById("calc-carbo").value) || 0;
  const g100 = parseFloat(document.getElementById("calc-grasa").value) || 0;
  const f100 = parseFloat(document.getElementById("calc-fibra").value) || 0;
  const gramosRacion = parseFloat(document.getElementById("calc-gramos-racion").value) || 0;
  const factor = gramosRacion / 100;
  const pp = calcularPP(p100 * factor, c100 * factor, g100 * factor, f100 * factor);
  document.getElementById("calc-resultado-pp").textContent = pp;
  return pp;
}

// ---------- Inicialización ----------
async function init() {
  state = loadState();
  await cargarAlimentos();

  document.getElementById("peso-fecha").value = todayStr();

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  document.querySelectorAll(".modo-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const dia = getDia(todayStr());
      dia.modalidad = btn.dataset.modo;
      saveState();
      renderHoy();
    });
  });

  document.getElementById("btn-add-alimento").addEventListener("click", abrirModal);
  document.getElementById("modal-close-btn").addEventListener("click", cerrarModal);
  document.getElementById("modal-alimento").addEventListener("click", (e) => {
    if (e.target.id === "modal-alimento") cerrarModal();
  });

  document.getElementById("buscador-alimento").addEventListener("input", renderResultadosBusqueda);
  document.getElementById("filtro-categoria").addEventListener("change", renderResultadosBusqueda);
  document.getElementById("filtro-pp-max").addEventListener("input", renderResultadosBusqueda);

  document.querySelectorAll(".franja-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      franjaSeleccionada = btn.dataset.franja;
      document.querySelectorAll(".franja-btn").forEach(b => b.classList.toggle("active", b === btn));
    });
  });

  document.getElementById("btn-abrir-calculadora").addEventListener("click", () => {
    document.getElementById("calculadora-manual").classList.toggle("hidden");
  });

  ["calc-proteina", "calc-carbo", "calc-grasa", "calc-fibra", "calc-gramos-racion"].forEach(id => {
    document.getElementById(id).addEventListener("input", actualizarCalculoManual);
  });

  document.getElementById("calc-foto-etiqueta").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) ocrEtiqueta(file);
  });

  document.getElementById("btn-add-calculado").addEventListener("click", () => {
    const nombre = document.getElementById("calc-nombre").value.trim();
    if (!nombre) { alert("Ponle un nombre al alimento."); return; }
    const gramosRacion = parseFloat(document.getElementById("calc-gramos-racion").value);
    if (!gramosRacion || gramosRacion <= 0) { alert("Indica los gramos de tu ración."); return; }
    const pp = actualizarCalculoManual();
    const alimento = {
      nombre,
      categoria: "Personalizado",
      racion: `${gramosRacion}g`,
      pp,
      saciante_dnc: false,
      fuente: "calculadora manual",
      version: "usuario",
      confianza: "N/A (cálculo propio)"
    };
    if (document.getElementById("calc-guardar").checked) {
      state.alimentosPersonalizados.push(alimento);
    }
    registrarAlimento(todayStr(), alimento, franjaSeleccionada);
    saveState();
    cerrarModal();
    renderHoy();
    // reset calculadora
    ["calc-nombre", "calc-proteina", "calc-carbo", "calc-grasa", "calc-fibra", "calc-gramos-racion"].forEach(id => {
      document.getElementById(id).value = "";
    });
    document.getElementById("calc-guardar").checked = false;
    document.getElementById("calc-resultado-pp").textContent = "0";
  });

  document.getElementById("btn-reservar").addEventListener("click", () => {
    const etiqueta = document.getElementById("reserva-etiqueta").value.trim();
    const pp = parseInt(document.getElementById("reserva-pp").value, 10);
    if (!etiqueta || !pp || pp <= 0) { alert("Indica una etiqueta y una cantidad de PP válida."); return; }
    const lunes = mondayOfWeek(todayStr());
    const semana = getSemana(lunes);
    semana.reservas.push({ id: Date.now() + "-" + Math.random().toString(36).slice(2, 7), etiqueta, pp });
    saveState();
    document.getElementById("reserva-etiqueta").value = "";
    document.getElementById("reserva-pp").value = "";
    renderExtra();
  });

  document.getElementById("btn-add-peso").addEventListener("click", () => {
    const fecha = document.getElementById("peso-fecha").value || todayStr();
    const kg = parseFloat(document.getElementById("peso-valor").value);
    if (!kg || kg <= 0) { alert("Indica un peso válido."); return; }
    state.pesos = state.pesos.filter(p => p.fecha !== fecha);
    state.pesos.push({ fecha, kg });
    saveState();
    document.getElementById("peso-valor").value = "";
    renderPeso();
  });

  renderHoy();
}

init();

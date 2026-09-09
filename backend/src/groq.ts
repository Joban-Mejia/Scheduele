import { config } from "./config";
import { logger } from "./logger";
import type { Bloque, HorarioEstructurado } from "./schedule";
import { DIAS_SEMANA, normalizarClaveDia, tryParseHHMM } from "./time";

/**
 * Error "de negocio": algo salió mal extrayendo el horario y el mensaje
 * es apto para mostrarle al usuario. `causaInterna` queda solo en logs.
 */
export class GroqExtractionError extends Error {
  public readonly causaInterna?: string;
  constructor(mensajeUsuario: string, causaInterna?: string) {
    super(mensajeUsuario);
    this.name = "GroqExtractionError";
    this.causaInterna = causaInterna;
  }
}

const PROMPT = `Sos un extractor de horarios semanales. Recibís UNA imagen (captura de pantalla)
de un horario académico o laboral y devolvés su contenido estructurado.

Respondé EXCLUSIVAMENTE con un objeto JSON válido, sin markdown, sin texto adicional,
con esta forma exacta:

{"dias":{"lunes":[{"inicio":"07:00","fin":"09:00","actividad":"Cálculo"}],"martes":[],"miercoles":[],"jueves":[],"viernes":[],"sabado":[],"domingo":[]}}

Reglas:
- Usá EXACTAMENTE estas claves de día, en minúsculas y SIN tildes: lunes, martes, miercoles, jueves, viernes, sabado, domingo.
- Incluí siempre las 7 claves. Si un día no tiene actividades, poné una lista vacía [].
- Horas en formato 24 horas "HH:MM" (ej. "08:00", "14:30").
- "inicio" siempre ANTES que "fin". No incluyas bloques que crucen la medianoche.
- "actividad" es el nombre de la materia, clase o turno. Si no se llega a leer, poné "Ocupado".
- Convertí rangos escritos como "7-9" o "7:00 a 9:00" al formato pedido.
- No inventes clases que no estén en la imagen. Los recreos/almuerzo NO son bloques ocupados.
- Si la imagen NO es un horario, está ilegible, o no podés extraer NINGÚN bloque con confianza,
  respondé SOLO con: {"error":"<motivo breve en español>"}`;

interface GroqChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Manda la imagen a Groq y devuelve el horario estructurado y saneado.
 * Lanza GroqExtractionError (mensaje apto para el usuario) ante cualquier
 * fallo de red, de formato, o de extracción.
 */
export async function extraerHorario(
  imagen: Buffer,
  mimeType: string,
): Promise<HorarioEstructurado> {
  const dataUrl = `data:${mimeType};base64,${imagen.toString("base64")}`;

  let respuesta: Response;
  try {
    respuesta = await fetch(`${config.groqBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.groqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.groqModel,
        temperature: 0,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    logger.error("Groq: fallo de red o timeout", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new GroqExtractionError(
      "No pudimos contactar el servicio de reconocimiento. Probá de nuevo en unos segundos.",
      "network",
    );
  }

  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    logger.error("Groq: respuesta HTTP no OK", {
      status: respuesta.status,
      cuerpo: cuerpo.slice(0, 800),
      modelo: config.groqModel,
    });
    const msg =
      respuesta.status === 401
        ? "La configuración del servidor es inválida (API key de Groq)."
        : respuesta.status === 429
          ? "El servicio de reconocimiento está saturado. Esperá un momento y reintentá."
          : "El servicio de reconocimiento devolvió un error. Probá de nuevo en unos segundos.";
    throw new GroqExtractionError(msg, `HTTP ${respuesta.status}`);
  }

  let payload: GroqChatResponse;
  try {
    payload = (await respuesta.json()) as GroqChatResponse;
  } catch {
    logger.error("Groq: cuerpo no es JSON");
    throw new GroqExtractionError(
      "El servicio de reconocimiento devolvió una respuesta inesperada. Reintentá.",
      "respuesta no-JSON",
    );
  }

  const contenido = payload.choices?.[0]?.message?.content ?? "";
  if (!contenido.trim()) {
    logger.error("Groq: contenido vacío", { payload: JSON.stringify(payload).slice(0, 800) });
    throw new GroqExtractionError(
      "No pudimos leer el horario de la imagen. Probá con una captura más nítida.",
      "contenido vacío",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extraerJson(contenido));
  } catch {
    logger.error("Groq: el contenido no es JSON parseable", {
      contenido: contenido.slice(0, 2000),
    });
    throw new GroqExtractionError(
      "No pudimos interpretar el horario de la imagen. Probá con una captura más nítida y recortada al horario.",
      "JSON.parse falló",
    );
  }

  if (esObjeto(parsed) && typeof parsed.error === "string") {
    logger.warn("Groq: el modelo no pudo extraer un horario", { motivo: parsed.error });
    throw new GroqExtractionError(
      `No pudimos leer el horario: ${parsed.error}. Probá con otra captura.`,
      `modelo reportó: ${parsed.error}`,
    );
  }

  const { horario, descartados } = validarHorario(parsed);
  if (!horario) {
    logger.error("Groq: la estructura devuelta no es válida", {
      contenido: contenido.slice(0, 2000),
    });
    throw new GroqExtractionError(
      "El horario extraído no tiene un formato válido. Probá con otra captura.",
      "shape inválida",
    );
  }
  if (descartados.length > 0) {
    logger.warn("Groq: se descartaron bloques inválidos del horario extraído", {
      cantidad: descartados.length,
      ejemplos: descartados.slice(0, 5),
    });
  }

  const totalBloques = Object.values(horario.dias).reduce(
    (acc, arr) => acc + (arr?.length ?? 0),
    0,
  );
  if (totalBloques === 0) {
    logger.warn("Groq: horario extraído sin ningún bloque", {
      contenido: contenido.slice(0, 1000),
    });
    throw new GroqExtractionError(
      "No encontramos ninguna clase o turno en la imagen. Probá con una captura del horario completo.",
      "0 bloques",
    );
  }

  return horario;
}

/** Si el modelo envolvió el JSON en ```...``` o texto, intenta recortarlo. */
function extraerJson(texto: string): string {
  const sinFences = texto.replace(/```(?:json)?/gi, "").trim();
  const primera = sinFences.indexOf("{");
  const ultima = sinFences.lastIndexOf("}");
  if (primera !== -1 && ultima !== -1 && ultima > primera) {
    return sinFences.slice(primera, ultima + 1);
  }
  return sinFences;
}

function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Valida y sanea la estructura devuelta por el LLM.
 * Devuelve `horario: null` si ni siquiera tiene la forma básica.
 * Los bloques individuales inválidos se descartan (no invalidan todo).
 */
export function validarHorario(parsed: unknown): {
  horario: HorarioEstructurado | null;
  descartados: Array<{ dia: string; bloque: unknown; motivo: string }>;
} {
  const descartados: Array<{ dia: string; bloque: unknown; motivo: string }> = [];
  if (!esObjeto(parsed)) return { horario: null, descartados };

  const diasRaw = esObjeto(parsed.dias) ? parsed.dias : parsed;
  if (!esObjeto(diasRaw)) return { horario: null, descartados };

  const dias: Record<string, Bloque[]> = {};
  for (const d of DIAS_SEMANA) dias[d] = [];

  let vioAlgunaClaveDeDia = false;
  for (const [clave, valor] of Object.entries(diasRaw)) {
    const dia = normalizarClaveDia(clave);
    if (!dia) continue;
    vioAlgunaClaveDeDia = true;
    if (!Array.isArray(valor)) {
      descartados.push({ dia, bloque: valor, motivo: "el día no es una lista" });
      continue;
    }
    for (const item of valor) {
      const bloque = validarBloque(item);
      if (bloque.ok) dias[dia]!.push(bloque.value);
      else descartados.push({ dia, bloque: item, motivo: bloque.motivo });
    }
  }

  if (!vioAlgunaClaveDeDia) return { horario: null, descartados };
  return { horario: { dias }, descartados };
}

function validarBloque(
  item: unknown,
):
  | { ok: true; value: Bloque }
  | { ok: false; motivo: string } {
  if (!esObjeto(item)) return { ok: false, motivo: "el bloque no es un objeto" };
  const inicio = String(item.inicio ?? "");
  const fin = String(item.fin ?? "");
  const iMin = tryParseHHMM(inicio);
  const fMin = tryParseHHMM(fin);
  if (iMin === null || fMin === null) return { ok: false, motivo: "hora ilegible" };
  const finReal = fMin === 0 && iMin > 0 ? 24 * 60 : fMin;
  if (finReal <= iMin) return { ok: false, motivo: "fin <= inicio" };
  const actividad =
    typeof item.actividad === "string" && item.actividad.trim()
      ? item.actividad.trim().slice(0, 120)
      : "Ocupado";
  return { ok: true, value: { inicio, fin, actividad } };
}

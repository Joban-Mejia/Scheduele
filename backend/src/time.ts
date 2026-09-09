/** Helpers de tiempo. Todo se maneja en minutos desde medianoche (0..1440). */

export const DIAS_SEMANA = [
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
  "domingo",
] as const;

export type Dia = (typeof DIAS_SEMANA)[number];

const MINUTOS_EN_DIA = 24 * 60;

/**
 * Convierte "HH:MM" (o "H:MM") a minutos desde medianoche.
 * Acepta "24:00" como fin de día (1440). Lanza RangeError si es inválido.
 */
export function parseHHMM(valor: string): number {
  if (typeof valor !== "string") {
    throw new RangeError(`Hora inválida: ${JSON.stringify(valor)}`);
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(valor.trim());
  if (!m) throw new RangeError(`Hora con formato inválido: "${valor}" (se espera HH:MM)`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) throw new RangeError(`Minutos fuera de rango en "${valor}"`);
  const total = h * 60 + min;
  if (total > MINUTOS_EN_DIA) throw new RangeError(`Hora fuera de rango en "${valor}"`);
  return total;
}

/** Igual que parseHHMM pero devuelve null en vez de lanzar. */
export function tryParseHHMM(valor: string): number | null {
  try {
    return parseHHMM(valor);
  } catch {
    return null;
  }
}

/** Minutos desde medianoche -> "HH:MM". Clampa a [0, 1440]. */
export function toHHMM(totalMin: number): string {
  const clamped = Math.max(0, Math.min(MINUTOS_EN_DIA, Math.round(totalMin)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Normaliza la clave de un día: minúsculas, sin tildes, sin espacios. */
export function normalizarClaveDia(clave: string): Dia | null {
  const limpio = clave
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  return (DIAS_SEMANA as readonly string[]).includes(limpio) ? (limpio as Dia) : null;
}

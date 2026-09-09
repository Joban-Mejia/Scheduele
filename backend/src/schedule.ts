import type { GridConfig } from "./config";
import { parseHHMM, toHHMM, tryParseHHMM } from "./time";

// ── Tipos de datos de horarios ────────────────────────────────────────

/** Bloque ocupado tal como lo devuelve el LLM. */
export interface Bloque {
  inicio: string; // "HH:MM"
  fin: string; // "HH:MM"
  actividad?: string;
}

/** Horario estructurado de UN participante. Claves de día normalizadas. */
export interface HorarioEstructurado {
  dias: Partial<Record<string, Bloque[]>>;
}

/** Intervalo en minutos desde medianoche; [inicio, fin). */
export interface Intervalo {
  inicio: number;
  fin: number;
}

export interface BloqueLibre {
  inicio: string;
  fin: string;
}

export interface GridLibre {
  /** Por cada día de la config: bloques donde TODOS están libres. */
  dias: Record<string, BloqueLibre[]>;
  config: GridConfig;
  participantes: string[];
  /** true cuando hay 2+ participantes con horario cargado. */
  suficientesParticipantes: boolean;
}

export interface BloqueDescartado {
  bloque: Bloque;
  motivo: string;
}

// ── Normalización de bloques ocupados ─────────────────────────────────

const MINUTOS_EN_DIA = 24 * 60;

/**
 * Convierte una lista de bloques crudos a intervalos en minutos, saneando:
 *  - descarta los que no parsean.
 *  - "00:00" como fin se interpreta como fin de día (1440).
 *  - clampa al rango [0, 1440].
 *  - descarta los que quedan con fin <= inicio (incl. los que cruzan medianoche).
 *  - fusiona los que se solapan o quedan pegados.
 */
export function normalizarBloques(bloques: Bloque[]): {
  intervalos: Intervalo[];
  descartados: BloqueDescartado[];
} {
  const intervalos: Intervalo[] = [];
  const descartados: BloqueDescartado[] = [];

  for (const bloque of bloques ?? []) {
    const inicioMin = tryParseHHMM(String(bloque?.inicio ?? ""));
    let finMin = tryParseHHMM(String(bloque?.fin ?? ""));

    if (inicioMin === null || finMin === null) {
      descartados.push({ bloque, motivo: "hora ilegible" });
      continue;
    }
    if (finMin === 0 && inicioMin > 0) finMin = MINUTOS_EN_DIA;

    const inicio = Math.max(0, Math.min(MINUTOS_EN_DIA, inicioMin));
    const fin = Math.max(0, Math.min(MINUTOS_EN_DIA, finMin));

    if (fin <= inicio) {
      descartados.push({ bloque, motivo: "fin <= inicio (o cruza medianoche)" });
      continue;
    }
    intervalos.push({ inicio, fin });
  }

  return { intervalos: fusionarIntervalos(intervalos), descartados };
}

/** Fusiona intervalos solapados o adyacentes. No muta la entrada. */
export function fusionarIntervalos(intervalos: Intervalo[]): Intervalo[] {
  if (intervalos.length === 0) return [];
  const ordenados = [...intervalos].sort((a, b) => a.inicio - b.inicio || a.fin - b.fin);
  const out: Intervalo[] = [{ ...ordenados[0]! }];
  for (let i = 1; i < ordenados.length; i++) {
    const actual = ordenados[i]!;
    const ultimo = out[out.length - 1]!;
    if (actual.inicio <= ultimo.fin) {
      ultimo.fin = Math.max(ultimo.fin, actual.fin);
    } else {
      out.push({ ...actual });
    }
  }
  return out;
}

/** Intervalos ocupados de un participante para un día puntual. */
export function ocupadosEnDia(horario: HorarioEstructurado, dia: string): Intervalo[] {
  const bloques = horario?.dias?.[dia] ?? [];
  return normalizarBloques(bloques).intervalos;
}

// ── Grilla de slots ──────────────────────────────────────────────────

/**
 * Divide el rango [rangoInicio, rangoFin) en slots de `granularidadMin`.
 * El remanente que no completa un slot entero se descarta.
 */
export function slotsDelRango(config: GridConfig): Intervalo[] {
  const inicio = parseHHMM(config.rangoInicio);
  const fin = parseHHMM(config.rangoFin);
  const paso = config.granularidadMin;

  if (!(paso > 0)) throw new RangeError("granularidadMin debe ser > 0");
  if (fin <= inicio) {
    throw new RangeError(`rangoFin (${config.rangoFin}) debe ser posterior a rangoInicio (${config.rangoInicio})`);
  }

  const slots: Intervalo[] = [];
  for (let s = inicio; s + paso <= fin; s += paso) {
    slots.push({ inicio: s, fin: s + paso });
  }
  return slots;
}

/** ¿Se solapan a y b? Contacto en el borde (a.fin === b.inicio) NO es solape. */
export function seSolapan(a: Intervalo, b: Intervalo): boolean {
  return a.inicio < b.fin && b.inicio < a.fin;
}

/** El slot está libre si no se solapa con ningún intervalo ocupado. */
export function slotLibre(slot: Intervalo, ocupados: Intervalo[]): boolean {
  return !ocupados.some((occ) => seSolapan(slot, occ));
}

/** Fusiona slots consecutivos (pegados) en bloques más grandes. */
function fusionarSlotsConsecutivos(slots: Intervalo[]): Intervalo[] {
  const out: Intervalo[] = [];
  for (const slot of slots) {
    const ultimo = out[out.length - 1];
    if (ultimo && ultimo.fin === slot.inicio) ultimo.fin = slot.fin;
    else out.push({ ...slot });
  }
  return out;
}

// ── Intersección de tiempos libres ───────────────────────────────────

export interface HorarioParticipante {
  alias: string;
  horario: HorarioEstructurado;
}

/**
 * Calcula, por día de la config, los bloques donde TODOS los participantes
 * están libres, en la granularidad indicada y dentro del rango horario.
 *
 * Con 0 participantes devuelve todos los días vacíos.
 * Con 1 participante devuelve sus propios huecos (útil como preview),
 * pero marca `suficientesParticipantes: false`.
 */
export function interseccionLibre(
  participantes: HorarioParticipante[],
  config: GridConfig,
): GridLibre {
  const slots = slotsDelRango(config);

  // Precalcular ocupados por participante y por día una sola vez.
  const ocupadosPorParticipante = participantes.map((p) => {
    const porDia: Record<string, Intervalo[]> = {};
    for (const dia of config.dias) porDia[dia] = ocupadosEnDia(p.horario, dia);
    return porDia;
  });

  const dias: Record<string, BloqueLibre[]> = {};

  // Sin participantes no hay nada que intersecar: todos los días vacíos.
  if (participantes.length === 0) {
    for (const dia of config.dias) dias[dia] = [];
    return { dias, config, participantes: [], suficientesParticipantes: false };
  }

  for (const dia of config.dias) {
    const libres = slots.filter((slot) =>
      ocupadosPorParticipante.every((porDia) => slotLibre(slot, porDia[dia] ?? [])),
    );
    dias[dia] = fusionarSlotsConsecutivos(libres).map((b) => ({
      inicio: toHHMM(b.inicio),
      fin: toHHMM(b.fin),
    }));
  }

  return {
    dias,
    config,
    participantes: participantes.map((p) => p.alias),
    suficientesParticipantes: participantes.length >= 2,
  };
}

import { config } from "./config";
import { logger } from "./logger";
import { generarCodigoSala } from "./roomCode";
import type { HorarioEstructurado } from "./schedule";

export interface ParticipanteEstado {
  alias: string;
  horario: HorarioEstructurado;
  subidoEn: number;
}

export interface Sala {
  codigo: string;
  creadaEn: number;
  ultimaActividad: number;
  participantes: Map<string, ParticipanteEstado>;
}

/**
 * Store de salas en memoria. El estado se pierde al reiniciar el proceso
 * (es intencional: no hay DB por ahora). Las salas inactivas se barren
 * cada `sweepIntervalMs` y expiran tras `roomTtlMs`.
 */
export class RoomStore {
  private readonly salas = new Map<string, Sala>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    private readonly ttlMs: number = config.roomTtlMs,
    private readonly sweepMs: number = config.sweepIntervalMs,
  ) {}

  crearSala(): Sala {
    let codigo = generarCodigoSala();
    while (this.salas.has(codigo)) codigo = generarCodigoSala();
    const ahora = Date.now();
    const sala: Sala = {
      codigo,
      creadaEn: ahora,
      ultimaActividad: ahora,
      participantes: new Map(),
    };
    this.salas.set(codigo, sala);
    logger.info("Sala creada", { codigo });
    return sala;
  }

  /** Devuelve la sala si existe y no está vencida; renueva su actividad. */
  obtenerSala(codigo: string): Sala | null {
    const sala = this.salas.get(codigo);
    if (!sala) return null;
    if (this.estaVencida(sala)) {
      this.salas.delete(codigo);
      logger.info("Sala vencida al accederla", { codigo });
      return null;
    }
    sala.ultimaActividad = Date.now();
    return sala;
  }

  /** Alta o reemplazo del horario de un participante (re-subida permitida). */
  setHorario(sala: Sala, alias: string, horario: HorarioEstructurado): ParticipanteEstado {
    const estado: ParticipanteEstado = { alias, horario, subidoEn: Date.now() };
    sala.participantes.set(claveAlias(alias), estado);
    sala.ultimaActividad = Date.now();
    return estado;
  }

  private estaVencida(sala: Sala): boolean {
    return Date.now() - sala.ultimaActividad > this.ttlMs;
  }

  /** Borra las salas vencidas. Devuelve cuántas borró. */
  barrer(): number {
    let borradas = 0;
    for (const [codigo, sala] of this.salas) {
      if (this.estaVencida(sala)) {
        this.salas.delete(codigo);
        borradas++;
      }
    }
    if (borradas > 0) logger.info("Barrido de salas vencidas", { borradas });
    return borradas;
  }

  iniciarSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.barrer(), this.sweepMs);
    this.sweeper.unref?.();
  }

  detenerSweeper(): void {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
  }

  get cantidadSalas(): number {
    return this.salas.size;
  }
}

/** Los alias se comparan sin distinguir mayúsculas ni espacios de más. */
export function claveAlias(alias: string): string {
  return alias.trim().toLowerCase().replace(/\s+/g, " ");
}

export const roomStore = new RoomStore();

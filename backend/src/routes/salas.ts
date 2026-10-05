import { Router, type Request, type Response, type NextFunction } from "express";
import { MulterError } from "multer";
import { config } from "../config";
import { extraerHorario, GroqExtractionError } from "../groq";
import { logger } from "../logger";
import { claveAlias, roomStore, type Sala } from "../rooms";
import { esCodigoValido, normalizarCodigoSala } from "../roomCode";
import {
  bloquesDesdeOcupacion,
  interseccionLibre,
  ocupacionSlots,
  slotsDelRango,
  type HorarioParticipante,
} from "../schedule";
import { detectarMimeReal, subirImagen } from "../upload";

export const salasRouter = Router();

const ALIAS_MAX = 40;

function validarAlias(raw: unknown): { ok: true; alias: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Falta el alias." };
  const alias = raw.trim().replace(/\s+/g, " ");
  if (alias.length < 1) return { ok: false, error: "El alias no puede estar vacío." };
  if (alias.length > ALIAS_MAX) {
    return { ok: false, error: `El alias no puede superar ${ALIAS_MAX} caracteres.` };
  }
  return { ok: true, alias };
}

/**
 * Valida que el body tenga una grilla de ocupación con la forma esperada:
 * un boolean (o algo truthy/falsy) por cada slot de cada día configurado.
 */
function validarOcupacion(
  raw: unknown,
): { ok: true; ocupacion: Record<string, boolean[]> } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Falta la grilla de ocupación ('ocupacion')." };
  }
  const cantidadSlots = slotsDelRango(config.grid).length;
  const ocupacion: Record<string, boolean[]> = {};
  const entrada = raw as Record<string, unknown>;

  for (const dia of config.grid.dias) {
    const valor = entrada[dia];
    if (!Array.isArray(valor) || valor.length !== cantidadSlots) {
      return {
        ok: false,
        error: `La grilla para '${dia}' debe tener exactamente ${cantidadSlots} valores.`,
      };
    }
    ocupacion[dia] = valor.map(Boolean);
  }

  return { ok: true, ocupacion };
}

/** Estado público de una sala + grilla de intersección ya calculada. */
function serializarSala(sala: Sala) {
  const participantes = [...sala.participantes.values()]
    .sort((a, b) => a.subidoEn - b.subidoEn)
    .map((p) => ({ alias: p.alias, subidoEn: new Date(p.subidoEn).toISOString() }));

  const horarios: HorarioParticipante[] = [...sala.participantes.values()].map((p) => ({
    alias: p.alias,
    horario: p.horario,
  }));

  const grilla = interseccionLibre(horarios, config.grid);

  return {
    codigo: sala.codigo,
    creadaEn: new Date(sala.creadaEn).toISOString(),
    participantes,
    grilla,
  };
}

// ── POST /api/salas ──────────────────────────────────────────────────
salasRouter.post("/", (_req: Request, res: Response) => {
  const sala = roomStore.crearSala();
  res.status(201).json({ codigo: sala.codigo });
});

// ── GET /api/salas/:codigo ───────────────────────────────────────────
salasRouter.get("/:codigo", (req: Request, res: Response) => {
  const codigo = normalizarCodigoSala(req.params.codigo ?? "");
  if (!esCodigoValido(codigo)) {
    return res.status(400).json({ error: "Código de sala inválido." });
  }
  const sala = roomStore.obtenerSala(codigo);
  if (!sala) return res.status(404).json({ error: "La sala no existe o expiró." });
  res.json(serializarSala(sala));
});

// ── POST /api/salas/:codigo/horarios ─────────────────────────────────
salasRouter.post(
  "/:codigo/horarios",
  (req: Request, res: Response, next: NextFunction) => {
    subirImagen(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof MulterError) {
        const msg =
          err.code === "LIMIT_FILE_SIZE"
            ? `La imagen supera el máximo de ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`
            : `Error al subir la imagen: ${err.message}`;
        return res.status(400).json({ error: msg });
      }
      return res.status(400).json({
        error: err instanceof Error ? err.message : "Error al subir la imagen.",
      });
    });
  },
  async (req: Request, res: Response) => {
    const codigo = normalizarCodigoSala(req.params.codigo ?? "");
    if (!esCodigoValido(codigo)) {
      return res.status(400).json({ error: "Código de sala inválido." });
    }
    const sala = roomStore.obtenerSala(codigo);
    if (!sala) return res.status(404).json({ error: "La sala no existe o expiró." });

    const aliasCheck = validarAlias(req.body?.alias);
    if (!aliasCheck.ok) return res.status(400).json({ error: aliasCheck.error });

    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      return res.status(400).json({ error: "Adjuntá una imagen del horario (campo 'imagen')." });
    }

    const mimeReal = detectarMimeReal(file.buffer);
    if (!mimeReal) {
      return res.status(400).json({
        error: "El archivo no parece una imagen JPG, PNG o WEBP válida.",
      });
    }

    try {
      const horario = await extraerHorario(file.buffer, mimeReal);
      const estado = roomStore.setHorario(sala, aliasCheck.alias, horario);
      logger.info("Horario cargado", {
        codigo,
        alias: claveAlias(aliasCheck.alias),
        bytes: file.size,
      });
      return res.status(201).json({
        alias: estado.alias,
        horario: estado.horario,
        sala: serializarSala(sala),
      });
    } catch (err) {
      if (err instanceof GroqExtractionError) {
        return res.status(422).json({ error: err.message });
      }
      logger.error("Error inesperado procesando horario", {
        codigo,
        error: err instanceof Error ? err.stack ?? err.message : String(err),
      });
      return res.status(500).json({ error: "Error interno procesando la imagen." });
    }
  },
);

// ── POST /api/salas/:codigo/horarios/preview ─────────────────────────
// Analiza la imagen con Groq pero NO guarda nada todavía: devuelve el
// horario detectado + una grilla de booleans (ocupado/libre por slot) para
// que el usuario la revise y edite ("por cuadraditos") antes de confirmar.
salasRouter.post(
  "/:codigo/horarios/preview",
  (req: Request, res: Response, next: NextFunction) => {
    subirImagen(req, res, (err: unknown) => {
      if (!err) return next();
      if (err instanceof MulterError) {
        const msg =
          err.code === "LIMIT_FILE_SIZE"
            ? `La imagen supera el máximo de ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`
            : `Error al subir la imagen: ${err.message}`;
        return res.status(400).json({ error: msg });
      }
      return res.status(400).json({
        error: err instanceof Error ? err.message : "Error al subir la imagen.",
      });
    });
  },
  async (req: Request, res: Response) => {
    const codigo = normalizarCodigoSala(req.params.codigo ?? "");
    if (!esCodigoValido(codigo)) {
      return res.status(400).json({ error: "Código de sala inválido." });
    }
    const sala = roomStore.obtenerSala(codigo);
    if (!sala) return res.status(404).json({ error: "La sala no existe o expiró." });

    const aliasCheck = validarAlias(req.body?.alias);
    if (!aliasCheck.ok) return res.status(400).json({ error: aliasCheck.error });

    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      return res.status(400).json({ error: "Adjuntá una imagen del horario (campo 'imagen')." });
    }

    const mimeReal = detectarMimeReal(file.buffer);
    if (!mimeReal) {
      return res.status(400).json({
        error: "El archivo no parece una imagen JPG, PNG o WEBP válida.",
      });
    }

    try {
      const horario = await extraerHorario(file.buffer, mimeReal);
      logger.info("Horario analizado (preview, sin guardar)", {
        codigo,
        alias: claveAlias(aliasCheck.alias),
        bytes: file.size,
      });
      return res.status(200).json({
        alias: aliasCheck.alias,
        horario,
        ocupacion: ocupacionSlots(horario, config.grid),
        config: config.grid,
      });
    } catch (err) {
      if (err instanceof GroqExtractionError) {
        return res.status(422).json({ error: err.message });
      }
      logger.error("Error inesperado analizando horario (preview)", {
        codigo,
        error: err instanceof Error ? err.stack ?? err.message : String(err),
      });
      return res.status(500).json({ error: "Error interno procesando la imagen." });
    }
  },
);

// ── POST /api/salas/:codigo/horarios/confirmar ───────────────────────
// Guarda la grilla de ocupación ya revisada/editada por el usuario (no
// recibe imagen: viene del paso de preview + los clicks de confirmación).
salasRouter.post("/:codigo/horarios/confirmar", (req: Request, res: Response) => {
  const codigo = normalizarCodigoSala(req.params.codigo ?? "");
  if (!esCodigoValido(codigo)) {
    return res.status(400).json({ error: "Código de sala inválido." });
  }
  const sala = roomStore.obtenerSala(codigo);
  if (!sala) return res.status(404).json({ error: "La sala no existe o expiró." });

  const aliasCheck = validarAlias(req.body?.alias);
  if (!aliasCheck.ok) return res.status(400).json({ error: aliasCheck.error });

  const ocupacionCheck = validarOcupacion(req.body?.ocupacion);
  if (!ocupacionCheck.ok) return res.status(400).json({ error: ocupacionCheck.error });

  const horario = bloquesDesdeOcupacion(ocupacionCheck.ocupacion, config.grid);
  const estado = roomStore.setHorario(sala, aliasCheck.alias, horario);
  logger.info("Horario confirmado y guardado", { codigo, alias: claveAlias(aliasCheck.alias) });

  return res.status(201).json({
    alias: estado.alias,
    horario: estado.horario,
    sala: serializarSala(sala),
  });
});

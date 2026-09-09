import { Router, type Request, type Response, type NextFunction } from "express";
import { MulterError } from "multer";
import { config } from "../config";
import { extraerHorario, GroqExtractionError } from "../groq";
import { logger } from "../logger";
import { claveAlias, roomStore, type Sala } from "../rooms";
import { esCodigoValido, normalizarCodigoSala } from "../roomCode";
import { interseccionLibre, type HorarioParticipante } from "../schedule";
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

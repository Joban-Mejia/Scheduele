import multer from "multer";
import { config } from "./config";

export const MIMES_PERMITIDOS = ["image/jpeg", "image/png", "image/webp"] as const;
export type MimePermitido = (typeof MIMES_PERMITIDOS)[number];

/** Middleware multer: una sola imagen en memoria, con límite de tamaño y tipo. */
export const subirImagen = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxUploadBytes,
    files: 1,
    fields: 5,
  },
  fileFilter: (_req, file, cb) => {
    if ((MIMES_PERMITIDOS as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}. Usá JPG, PNG o WEBP.`));
    }
  },
}).single("imagen");

/**
 * Verifica los magic bytes del buffer y devuelve el mime "real".
 * Devuelve null si no coincide con ningún formato de imagen permitido.
 */
export function detectarMimeReal(buf: Buffer): MimePermitido | null {
  if (buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

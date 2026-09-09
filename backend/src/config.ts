import "dotenv/config";

function leerNumero(nombre: string, def: number): number {
  const raw = process.env[nombre];
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`La variable de entorno ${nombre} no es un número válido: "${raw}"`);
  }
  return n;
}

function leerLista(nombre: string, def: string[]): string[] {
  const raw = process.env[nombre];
  if (raw === undefined || raw.trim() === "") return def;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export interface GridConfig {
  granularidadMin: number;
  rangoInicio: string;
  rangoFin: string;
  dias: string[];
}

export interface Config {
  port: number;
  groqApiKey: string;
  groqModel: string;
  groqBaseUrl: string;
  corsOrigins: string[] | "*";
  maxUploadBytes: number;
  roomTtlMs: number;
  sweepIntervalMs: number;
  grid: GridConfig;
}

function construirConfig(): Config {
  const corsRaw = (process.env.CORS_ORIGINS ?? "*").trim();
  const corsOrigins: string[] | "*" =
    corsRaw === "*" || corsRaw === ""
      ? "*"
      : corsRaw.split(",").map((s) => s.trim()).filter(Boolean);

  return {
    port: leerNumero("PORT", 3000),
    groqApiKey: process.env.GROQ_API_KEY ?? "",
    groqModel: process.env.GROQ_VISION_MODEL ?? "qwen/qwen3.8-27b",
    groqBaseUrl: (process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/+$/, ""),
    corsOrigins,
    maxUploadBytes: leerNumero("MAX_UPLOAD_BYTES", 8 * 1024 * 1024),
    roomTtlMs: leerNumero("ROOM_TTL_HOURS", 6) * 60 * 60 * 1000,
    sweepIntervalMs: leerNumero("ROOM_SWEEP_MINUTES", 10) * 60 * 1000,
    grid: {
      granularidadMin: leerNumero("GRID_GRANULARIDAD_MIN", 30),
      rangoInicio: process.env.GRID_RANGO_INICIO ?? "06:00",
      rangoFin: process.env.GRID_RANGO_FIN ?? "22:00",
      dias: leerLista("GRID_DIAS", [
        "lunes",
        "martes",
        "miercoles",
        "jueves",
        "viernes",
        "sabado",
      ]),
    },
  };
}

export const config: Config = construirConfig();

/** Falla temprano si falta algo imprescindible para arrancar el server. */
export function assertConfig(cfg: Config = config): void {
  if (!cfg.groqApiKey) {
    throw new Error(
      "Falta GROQ_API_KEY. Copiá backend/.env.example a backend/.env y completá la key.",
    );
  }
  if (cfg.grid.granularidadMin <= 0) {
    throw new Error("GRID_GRANULARIDAD_MIN debe ser mayor a 0.");
  }
  if (cfg.grid.dias.length === 0) {
    throw new Error("GRID_DIAS no puede quedar vacío.");
  }
}

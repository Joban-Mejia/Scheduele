/**
 * Logger mínimo con timestamp y metadata JSON.
 * Los errores de parseo del LLM y los HTTP de Groq se registran acá
 * (nunca se exponen al usuario final).
 */
type Nivel = "debug" | "info" | "warn" | "error";

function emit(nivel: Nivel, msg: string, meta?: Record<string, unknown>): void {
  const linea: Record<string, unknown> = {
    ts: new Date().toISOString(),
    nivel,
    msg,
  };
  if (meta && Object.keys(meta).length > 0) linea.meta = meta;
  const salida = JSON.stringify(linea);
  if (nivel === "error") console.error(salida);
  else if (nivel === "warn") console.warn(salida);
  else console.log(salida);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};

import path from "node:path";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { config } from "./config";
import { logger } from "./logger";
import { roomStore } from "./rooms";
import { salasRouter } from "./routes/salas";

/** Crea la app Express sin arrancar el server (para poder testearla). */
export function crearApp() {
  const app = express();

  app.use(
    cors({
      origin: config.corsOrigins === "*" ? true : config.corsOrigins,
    }),
  );
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ ok: true, salas: roomStore.cantidadSalas, ts: new Date().toISOString() });
  });

  app.use("/api/salas", salasRouter);

  // Frontend estático (si existe la carpeta ../public o ../../frontend).
  const publicDir = path.resolve(__dirname, "..", "public");
  app.use(express.static(publicDir));
  app.get(/^(?!\/api\/).*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, "index.html"), (err) => {
      if (err) res.status(404).json({ error: "No encontrado." });
    });
  });

  // Handler de errores final.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("Error no capturado en middleware", {
      error: err instanceof Error ? err.stack ?? err.message : String(err),
    });
    if (res.headersSent) return;
    res.status(500).json({ error: "Error interno del servidor." });
  });

  return app;
}

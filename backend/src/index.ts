import { crearApp } from "./app";
import { assertConfig, config } from "./config";
import { logger } from "./logger";
import { roomStore } from "./rooms";

function main() {
  assertConfig();

  const app = crearApp();
  roomStore.iniciarSweeper();

  const server = app.listen(config.port, () => {
    logger.info("HorarioComún backend escuchando", {
      port: config.port,
      modeloGroq: config.groqModel,
      grid: config.grid,
    });
  });

  const cerrar = (sig: string) => {
    logger.info("Cerrando servidor", { sig });
    roomStore.detenerSweeper();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", () => cerrar("SIGINT"));
  process.on("SIGTERM", () => cerrar("SIGTERM"));
}

try {
  main();
} catch (err) {
  logger.error("No se pudo arrancar el servidor", {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
}

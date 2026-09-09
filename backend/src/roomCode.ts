import { randomInt } from "node:crypto";

// Sin caracteres ambiguos (0/O, 1/I/L).
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Genera un código de sala de `longitud` caracteres (default 6). */
export function generarCodigoSala(longitud = 6): string {
  let out = "";
  for (let i = 0; i < longitud; i++) {
    out += ALFABETO[randomInt(ALFABETO.length)];
  }
  return out;
}

/** Normaliza lo que escribe el usuario: mayúsculas, sin espacios ni guiones. */
export function normalizarCodigoSala(entrada: string): string {
  return entrada.trim().toUpperCase().replace(/[\s-]/g, "");
}

const RE_CODIGO = /^[A-Z0-9]{4,10}$/;

export function esCodigoValido(codigo: string): boolean {
  return RE_CODIGO.test(codigo);
}

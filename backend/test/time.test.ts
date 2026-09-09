import { describe, expect, it } from "vitest";
import { normalizarClaveDia, parseHHMM, toHHMM, tryParseHHMM } from "../src/time";

describe("parseHHMM", () => {
  it("parsea horas normales", () => {
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("07:30")).toBe(450);
    expect(parseHHMM("23:59")).toBe(1439);
  });

  it("acepta hora de un dígito y 24:00 como fin de día", () => {
    expect(parseHHMM("7:00")).toBe(420);
    expect(parseHHMM("24:00")).toBe(1440);
  });

  it("recorta espacios", () => {
    expect(parseHHMM("  09:15 ")).toBe(555);
  });

  it("rechaza formatos inválidos", () => {
    expect(() => parseHHMM("9")).toThrow(RangeError);
    expect(() => parseHHMM("09:5")).toThrow(RangeError);
    expect(() => parseHHMM("09-15")).toThrow(RangeError);
    expect(() => parseHHMM("24:01")).toThrow(RangeError);
    expect(() => parseHHMM("10:60")).toThrow(RangeError);
    expect(() => parseHHMM("")).toThrow(RangeError);
  });

  it("tryParseHHMM devuelve null en vez de lanzar", () => {
    expect(tryParseHHMM("nope")).toBeNull();
    expect(tryParseHHMM("08:00")).toBe(480);
  });
});

describe("toHHMM", () => {
  it("formatea y clampa", () => {
    expect(toHHMM(0)).toBe("00:00");
    expect(toHHMM(450)).toBe("07:30");
    expect(toHHMM(1440)).toBe("24:00");
    expect(toHHMM(-10)).toBe("00:00");
    expect(toHHMM(99999)).toBe("24:00");
  });
});

describe("normalizarClaveDia", () => {
  it("normaliza tildes, mayúsculas y espacios", () => {
    expect(normalizarClaveDia("Miércoles")).toBe("miercoles");
    expect(normalizarClaveDia("  SÁBADO ")).toBe("sabado");
    expect(normalizarClaveDia("lunes")).toBe("lunes");
  });

  it("devuelve null para claves desconocidas", () => {
    expect(normalizarClaveDia("holiday")).toBeNull();
    expect(normalizarClaveDia("lun")).toBeNull();
  });
});

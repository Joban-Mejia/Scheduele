import { describe, expect, it } from "vitest";
import { validarHorario } from "../src/groq";

describe("validarHorario", () => {
  it("acepta la forma canónica y completa los 7 días", () => {
    const { horario } = validarHorario({
      dias: { lunes: [{ inicio: "07:00", fin: "09:00", actividad: "Cálculo" }] },
    });
    expect(horario).not.toBeNull();
    expect(Object.keys(horario!.dias).sort()).toEqual(
      ["domingo", "jueves", "lunes", "martes", "miercoles", "sabado", "viernes"].sort(),
    );
    expect(horario!.dias.lunes).toEqual([
      { inicio: "07:00", fin: "09:00", actividad: "Cálculo" },
    ]);
    expect(horario!.dias.martes).toEqual([]);
  });

  it("normaliza claves de día con tildes y descarta claves desconocidas", () => {
    const { horario } = validarHorario({
      dias: {
        Miércoles: [{ inicio: "10:00", fin: "11:00" }],
        feriado: [{ inicio: "08:00", fin: "09:00" }],
      },
    });
    expect(horario!.dias.miercoles).toEqual([
      { inicio: "10:00", fin: "11:00", actividad: "Ocupado" },
    ]);
  });

  it("acepta el objeto de días sin el wrapper 'dias'", () => {
    const { horario } = validarHorario({ lunes: [{ inicio: "07:00", fin: "08:00" }] });
    expect(horario!.dias.lunes).toHaveLength(1);
  });

  it("descarta bloques inválidos sin invalidar todo el horario", () => {
    const { horario, descartados } = validarHorario({
      dias: {
        lunes: [
          { inicio: "07:00", fin: "09:00" },
          { inicio: "10:00", fin: "09:00" },
          { inicio: "nope", fin: "12:00" },
          "basura",
        ],
      },
    });
    expect(horario!.dias.lunes).toHaveLength(1);
    expect(descartados).toHaveLength(3);
  });

  it("devuelve null si no hay ninguna clave de día reconocible", () => {
    expect(validarHorario({ foo: 1 }).horario).toBeNull();
    expect(validarHorario("texto").horario).toBeNull();
    expect(validarHorario(null).horario).toBeNull();
    expect(validarHorario({ dias: 42 }).horario).toBeNull();
  });

  it("trunca actividades larguísimas", () => {
    const { horario } = validarHorario({
      dias: { lunes: [{ inicio: "07:00", fin: "08:00", actividad: "x".repeat(500) }] },
    });
    expect(horario!.dias.lunes![0]!.actividad!.length).toBe(120);
  });
});

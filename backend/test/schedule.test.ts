import { describe, expect, it } from "vitest";
import type { GridConfig } from "../src/config";
import {
  fusionarIntervalos,
  interseccionLibre,
  normalizarBloques,
  ocupadosEnDia,
  seSolapan,
  slotLibre,
  slotsDelRango,
  type Bloque,
  type HorarioEstructurado,
  type HorarioParticipante,
} from "../src/schedule";

function cfg(over: Partial<GridConfig> = {}): GridConfig {
  return {
    granularidadMin: 30,
    rangoInicio: "06:00",
    rangoFin: "22:00",
    dias: ["lunes"],
    ...over,
  };
}

function participante(alias: string, dias: HorarioEstructurado["dias"]): HorarioParticipante {
  return { alias, horario: { dias } };
}

function b(inicio: string, fin: string, actividad = "x"): Bloque {
  return { inicio, fin, actividad };
}

// ── slotsDelRango ────────────────────────────────────────────────────
describe("slotsDelRango", () => {
  it("06:00-22:00 con granularidad 30 => 32 slots exactos", () => {
    const slots = slotsDelRango(cfg());
    expect(slots).toHaveLength(32);
    expect(slots[0]).toEqual({ inicio: 360, fin: 390 });
    expect(slots.at(-1)).toEqual({ inicio: 1290, fin: 1320 });
  });

  it("descarta el remanente que no completa un slot entero", () => {
    const slots = slotsDelRango(cfg({ rangoInicio: "06:00", rangoFin: "08:15" }));
    expect(slots.map((s) => s.inicio)).toEqual([360, 390, 420, 450]);
    expect(slots.at(-1)).toEqual({ inicio: 450, fin: 480 }); // 08:00, no 08:15
  });

  it("respeta granularidades distintas", () => {
    expect(slotsDelRango(cfg({ granularidadMin: 60 }))).toHaveLength(16);
    expect(slotsDelRango(cfg({ granularidadMin: 15 }))).toHaveLength(64);
  });

  it("lanza si el rango es inválido", () => {
    expect(() => slotsDelRango(cfg({ rangoInicio: "22:00", rangoFin: "06:00" }))).toThrow(RangeError);
    expect(() => slotsDelRango(cfg({ rangoInicio: "10:00", rangoFin: "10:00" }))).toThrow(RangeError);
    expect(() => slotsDelRango(cfg({ granularidadMin: 0 }))).toThrow(RangeError);
  });
});

// ── solape / slot libre ──────────────────────────────────────────────
describe("seSolapan / slotLibre", () => {
  it("el contacto en el borde no es solape", () => {
    expect(seSolapan({ inicio: 480, fin: 510 }, { inicio: 510, fin: 540 })).toBe(false);
    expect(seSolapan({ inicio: 510, fin: 540 }, { inicio: 480, fin: 510 })).toBe(false);
  });

  it("detecta solape parcial y total", () => {
    expect(seSolapan({ inicio: 480, fin: 510 }, { inicio: 500, fin: 520 })).toBe(true);
    expect(seSolapan({ inicio: 480, fin: 510 }, { inicio: 400, fin: 600 })).toBe(true);
  });

  it("un slot pegado a un bloque ocupado sigue libre", () => {
    expect(slotLibre({ inicio: 480, fin: 510 }, [{ inicio: 510, fin: 600 }])).toBe(true);
    expect(slotLibre({ inicio: 480, fin: 510 }, [{ inicio: 509, fin: 600 }])).toBe(false);
  });
});

// ── normalizarBloques ────────────────────────────────────────────────
describe("normalizarBloques", () => {
  it("fusiona bloques solapados y adyacentes", () => {
    const { intervalos } = normalizarBloques([b("07:00", "08:00"), b("07:30", "09:00")]);
    expect(intervalos).toEqual([{ inicio: 420, fin: 540 }]);

    const pegados = normalizarBloques([b("07:00", "08:00"), b("08:00", "09:00")]);
    expect(pegados.intervalos).toEqual([{ inicio: 420, fin: 540 }]);
  });

  it("descarta bloques con fin <= inicio", () => {
    const { intervalos, descartados } = normalizarBloques([
      b("09:00", "09:00"),
      b("10:00", "09:00"),
      b("08:00", "09:00"),
    ]);
    expect(intervalos).toEqual([{ inicio: 480, fin: 540 }]);
    expect(descartados).toHaveLength(2);
  });

  it("interpreta fin '00:00' como fin de día", () => {
    const { intervalos } = normalizarBloques([b("22:00", "00:00")]);
    expect(intervalos).toEqual([{ inicio: 1320, fin: 1440 }]);
  });

  it("descarta bloques con horas ilegibles", () => {
    const { intervalos, descartados } = normalizarBloques([
      { inicio: "manana", fin: "tarde" } as Bloque,
      b("25:00", "26:00"),
    ]);
    expect(intervalos).toEqual([]);
    expect(descartados).toHaveLength(2);
    expect(descartados[0]?.motivo).toContain("ilegible");
  });

  it("fusionarIntervalos no muta la entrada", () => {
    const entrada = [
      { inicio: 100, fin: 200 },
      { inicio: 50, fin: 120 },
    ];
    const copia = JSON.parse(JSON.stringify(entrada));
    fusionarIntervalos(entrada);
    expect(entrada).toEqual(copia);
  });

  it("ocupadosEnDia lee el día correcto y devuelve [] si no existe", () => {
    const h: HorarioEstructurado = { dias: { lunes: [b("08:00", "09:00")] } };
    expect(ocupadosEnDia(h, "lunes")).toEqual([{ inicio: 480, fin: 540 }]);
    expect(ocupadosEnDia(h, "martes")).toEqual([]);
  });
});

// ── interseccionLibre ────────────────────────────────────────────────
describe("interseccionLibre", () => {
  it("dos participantes: resta la unión de bloques ocupados", () => {
    const g = interseccionLibre(
      [
        participante("ana", { lunes: [b("08:00", "10:00")] }),
        participante("beto", { lunes: [b("09:00", "11:00")] }),
      ],
      cfg(),
    );
    expect(g.dias.lunes).toEqual([
      { inicio: "06:00", fin: "08:00" },
      { inicio: "11:00", fin: "22:00" },
    ]);
    expect(g.suficientesParticipantes).toBe(true);
    expect(g.participantes).toEqual(["ana", "beto"]);
  });

  it("si alguien está ocupado todo el rango, ese día no tiene huecos", () => {
    const g = interseccionLibre(
      [
        participante("ana", { lunes: [b("06:00", "22:00")] }),
        participante("beto", { lunes: [] }),
      ],
      cfg(),
    );
    expect(g.dias.lunes).toEqual([]);
  });

  it("horarios vacíos => todo el rango libre en un solo bloque", () => {
    const g = interseccionLibre(
      [participante("ana", {}), participante("beto", { lunes: [] })],
      cfg(),
    );
    expect(g.dias.lunes).toEqual([{ inicio: "06:00", fin: "22:00" }]);
  });

  it("un bloque fuera de grilla ocupa todos los slots que toca", () => {
    const g = interseccionLibre(
      [
        participante("ana", { lunes: [b("07:15", "08:45")] }),
        participante("beto", {}),
      ],
      cfg(),
    );
    // 07:15-08:45 con slots de 30' ocupa 07:00..09:00
    expect(g.dias.lunes).toEqual([
      { inicio: "06:00", fin: "07:00" },
      { inicio: "09:00", fin: "22:00" },
    ]);
  });

  it("ignora bloques fuera del rango horario", () => {
    const g = interseccionLibre(
      [
        participante("ana", { lunes: [b("05:00", "05:45"), b("22:30", "23:30")] }),
        participante("beto", {}),
      ],
      cfg(),
    );
    expect(g.dias.lunes).toEqual([{ inicio: "06:00", fin: "22:00" }]);
  });

  it("maneja días donde un participante no tiene la clave", () => {
    const g = interseccionLibre(
      [
        participante("ana", { lunes: [b("08:00", "09:00")] }),
        participante("beto", { martes: [b("10:00", "11:00")] }),
      ],
      cfg({ dias: ["lunes", "martes"] }),
    );
    expect(g.dias.lunes).toEqual([
      { inicio: "06:00", fin: "08:00" },
      { inicio: "09:00", fin: "22:00" },
    ]);
    expect(g.dias.martes).toEqual([
      { inicio: "06:00", fin: "10:00" },
      { inicio: "11:00", fin: "22:00" },
    ]);
  });

  it("tres participantes: resta la unión de todos", () => {
    const g = interseccionLibre(
      [
        participante("a", { lunes: [b("08:00", "12:00")] }),
        participante("b", { lunes: [b("13:00", "14:00")] }),
        participante("c", { lunes: [b("09:00", "10:00"), b("15:00", "16:00")] }),
      ],
      cfg(),
    );
    expect(g.dias.lunes).toEqual([
      { inicio: "06:00", fin: "08:00" },
      { inicio: "12:00", fin: "13:00" },
      { inicio: "14:00", fin: "15:00" },
      { inicio: "16:00", fin: "22:00" },
    ]);
  });

  it("no fusiona bloques libres separados por un único slot ocupado", () => {
    const g = interseccionLibre(
      [
        participante("ana", { lunes: [b("12:00", "12:30")] }),
        participante("beto", {}),
      ],
      cfg(),
    );
    expect(g.dias.lunes).toEqual([
      { inicio: "06:00", fin: "12:00" },
      { inicio: "12:30", fin: "22:00" },
    ]);
  });

  it("la granularidad agranda el bloque ocupado al slot completo", () => {
    const g = interseccionLibre(
      [
        participante("ana", { lunes: [b("08:00", "08:30")] }),
        participante("beto", {}),
      ],
      cfg({ granularidadMin: 60 }),
    );
    expect(g.dias.lunes).toEqual([
      { inicio: "06:00", fin: "08:00" },
      { inicio: "09:00", fin: "22:00" },
    ]);
  });

  it("sin participantes: todos los días vacíos y suficientesParticipantes=false", () => {
    const g = interseccionLibre([], cfg({ dias: ["lunes", "martes"] }));
    expect(g.dias).toEqual({ lunes: [], martes: [] });
    expect(g.suficientesParticipantes).toBe(false);
  });

  it("con un solo participante calcula sus huecos pero marca falta de gente", () => {
    const g = interseccionLibre(
      [participante("ana", { lunes: [b("08:00", "09:00")] })],
      cfg(),
    );
    expect(g.dias.lunes).toEqual([
      { inicio: "06:00", fin: "08:00" },
      { inicio: "09:00", fin: "22:00" },
    ]);
    expect(g.suficientesParticipantes).toBe(false);
  });

  it("solo devuelve los días de la config", () => {
    const g = interseccionLibre(
      [
        participante("ana", { lunes: [], domingo: [b("08:00", "09:00")] }),
        participante("beto", {}),
      ],
      cfg({ dias: ["lunes"] }),
    );
    expect(Object.keys(g.dias)).toEqual(["lunes"]);
  });
});

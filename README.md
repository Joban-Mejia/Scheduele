# HorarioComún

Herramienta para encontrar los huecos de tiempo libre **en común** de un grupo.
Cada persona sube una captura de pantalla de su horario semanal, un LLM con visión
de [Groq](https://groq.com) la convierte a datos estructurados, y el backend calcula
y muestra una grilla con los bloques en los que **todos** están libres.

> Estado: **backend funcional** (subida + extracción con Groq + intersección de
> horarios libres + tests). El frontend está en `frontend/` y se documenta más abajo.

## Cómo funciona

1. Alguien **crea una sala** y comparte el código de 6 caracteres.
2. Cada participante entra a la sala, pone un **alias** y sube **una imagen** (JPG/PNG/WEBP) de su horario.
3. El backend manda la imagen a Groq con un prompt que pide el horario en JSON:
   ```json
   {
     "dias": {
       "lunes": [{ "inicio": "07:00", "fin": "09:00", "actividad": "Cálculo" }],
       "martes": []
     }
   }
   ```
4. Con 2+ horarios cargados, el backend calcula la **intersección de tiempos libres**
   por día, en bloques de granularidad configurable (30 min por defecto) dentro de un
   rango horario (06:00–22:00 por defecto).
5. El frontend hace *polling* del estado de la sala y refresca la grilla cuando entra gente nueva.

El **estado vive en memoria** del backend, por sala, y cada sala **expira tras 6 h**
de inactividad (configurable). No hay base de datos.

## Estructura del repo

```
backend/    API en Node + Express + TypeScript
frontend/   cliente estático (HTML/CSS/JS)  ← pendiente
```

---

## Backend

### Requisitos

- Node.js 20+ (probado con 24).
- Una API key de Groq: https://console.groq.com/keys

### Instalación y ejecución local

```bash
cd backend
npm install
cp .env.example .env        # y completá GROQ_API_KEY
npm run dev                  # http://localhost:3000  (recarga en caliente)
```

Para producción:

```bash
npm run build                # compila a dist/
npm start
```

Otros scripts:

| Script              | Qué hace                                 |
| ------------------- | ---------------------------------------- |
| `npm test`          | corre los tests (Vitest)                 |
| `npm run test:watch`| tests en modo watch                      |
| `npm run typecheck` | `tsc --noEmit` sobre todo el proyecto    |

### Variables de entorno

Están todas documentadas en [`backend/.env.example`](backend/.env.example). Las más importantes:

| Variable             | Default                        | Descripción                                                        |
| -------------------- | ------------------------------ | ------------------------------------------------------------------ |
| `GROQ_API_KEY`       | —                              | **Obligatoria.** Solo en el backend, nunca se expone al frontend.  |
| `GROQ_VISION_MODEL`  | `qwen/qwen3.8-27b`             | Modelo de visión de Groq. Ver nota abajo.                          |
| `PORT`               | `3000`                         | Puerto HTTP.                                                       |
| `CORS_ORIGINS`       | `*`                            | Orígenes permitidos, separados por coma.                           |
| `MAX_UPLOAD_BYTES`   | `8388608` (8 MiB)              | Tamaño máximo de imagen.                                           |
| `ROOM_TTL_HOURS`     | `6`                            | Horas de inactividad antes de borrar una sala.                     |
| `GRID_GRANULARIDAD_MIN` | `30`                        | Tamaño de los bloques de la grilla.                                |
| `GRID_RANGO_INICIO` / `GRID_RANGO_FIN` | `06:00` / `22:00` | Rango horario visible.                                     |
| `GRID_DIAS`          | `lunes,…,sabado`               | Días a considerar (minúsculas, sin tildes).                        |

#### Sobre el modelo de Groq

Groq rota los modelos disponibles. Al momento de escribir esto, los modelos con
**soporte de visión** son `qwen/qwen3.8-27b` y `qwen/qwen3.6-27b`. **Antes de
desplegar, verificá el modelo vigente** en https://console.groq.com/docs/vision y
ajustá `GROQ_VISION_MODEL`. El código no fija el modelo: se lee de la variable de entorno.

### API

Todas las rutas cuelgan de `/api`.

#### `POST /api/salas`
Crea una sala.
```json
201 → { "codigo": "TCXRPK" }
```

#### `POST /api/salas/:codigo/horarios`
`multipart/form-data` con:
- `alias` (texto, 1–40 chars)
- `imagen` (archivo JPG/PNG/WEBP, ≤ 8 MiB)

Procesa la imagen con Groq y guarda el horario del participante (si el alias ya
existía, lo reemplaza).

```json
201 → { "alias": "Ana", "horario": { "dias": { … } }, "sala": { …estado completo… } }
400 → alias/imagen inválidos (tipo, tamaño, magic bytes)
404 → la sala no existe o expiró
422 → { "error": "No pudimos leer el horario: … Probá con otra captura." }
```

El backend **valida el tipo real** de la imagen por *magic bytes*, no solo por el
`Content-Type`. Los errores de parseo del JSON del LLM y los HTTP de Groq se
**loguean en el backend** (nunca se exponen), para poder ajustar el prompt.

#### `GET /api/salas/:codigo`
Estado actual de la sala + grilla ya calculada.
```json
200 → {
  "codigo": "TCXRPK",
  "creadaEn": "2026-09-08T19:52:31.367Z",
  "participantes": [{ "alias": "Ana", "subidoEn": "…" }],
  "grilla": {
    "dias": { "lunes": [{ "inicio": "09:00", "fin": "11:00" }], "martes": [] },
    "config": { "granularidadMin": 30, "rangoInicio": "06:00", "rangoFin": "22:00", "dias": [ … ] },
    "participantes": ["Ana"],
    "suficientesParticipantes": false
  }
}
404 → la sala no existe o expiró
```

#### `GET /api/health`
```json
200 → { "ok": true, "salas": 3, "ts": "…" }
```

### Lógica de intersección de horarios libres

Vive en [`backend/src/schedule.ts`](backend/src/schedule.ts) y es **pura** (sin I/O),
para poder testearla a fondo. Idea:

1. El rango horario se divide en *slots* de `granularidadMin` (el remanente que no
   completa un slot entero se descarta).
2. Los bloques ocupados de cada persona se normalizan: se descartan los ilegibles y
   los que tienen `fin <= inicio`, `"00:00"` como fin se interpreta como fin de día,
   y los solapados se fusionan.
3. Un slot está **libre para una persona** si no se solapa con ninguno de sus bloques
   ocupados. El contacto en el borde (`08:00–08:30` vs `08:30–09:00`) **no** es solape.
4. Un slot es **libre en común** si está libre para *todas* las personas.
5. Los slots libres consecutivos se fusionan en bloques para mostrar.

Casos borde cubiertos por los tests ([`backend/test/schedule.test.ts`](backend/test/schedule.test.ts)):
bloques fuera de grilla, fuera de rango, que abarcan todo el día, granularidades
distintas, días sin datos para una persona, fusión y no-fusión de bloques
adyacentes, 0 / 1 / 3 participantes.

```bash
cd backend && npm test
```

---

## Frontend

Cliente estático pensado para móvil. Dos pantallas:

1. **Inicio:** crear sala / unirse con código.
2. **Sala:** alias + subir imagen, lista de quién ya subió, y la grilla de huecos en común (se refresca sola por *polling*).

Se sirve de dos maneras:

- **Junto al backend:** copiá el build del frontend a `backend/public/` y el mismo
  servidor Express lo sirve (ya está el `express.static` + *fallback* a `index.html`).
- **Aparte (GitHub Pages):** subí el frontend a Pages y configurá la URL del backend
  como variable del cliente; acordate de agregar el origen de Pages a `CORS_ORIGINS`.

---

## Despliegue

### Backend (Render / Railway / Fly)

- **Build:** `npm --prefix backend install && npm --prefix backend run build`
- **Start:** `npm --prefix backend start`
- **Env:** `GROQ_API_KEY` (secreto), `GROQ_VISION_MODEL`, `CORS_ORIGINS` con el
  origen del frontend, y opcionalmente los `GRID_*`.
- El estado es **en memoria**: si la plataforma reinicia o escala a varias
  instancias, las salas se pierden / no se comparten. Para este uso (grupos chicos,
  sesiones cortas) alcanza; si hiciera falta, el siguiente paso es mover el store a
  Redis.

### Frontend

- **Mismo servidor:** copiar el build a `backend/public/`.
- **GitHub Pages:** deploy estático apuntando al backend desplegado (+ CORS).

## Notas de seguridad

- La API key de Groq vive **solo** en el backend, como variable de entorno.
- Se valida **tipo (magic bytes) y tamaño** de la imagen antes de mandarla a Groq.
- CORS restringible por `CORS_ORIGINS`.
- No hay auth: quien tenga el código de sala puede sumar/ver horarios. Es
  intencional para el caso de uso (grupo de conocidos, salas efímeras).

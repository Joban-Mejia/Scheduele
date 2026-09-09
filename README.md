# HorarioComún

Herramienta para encontrar los huecos de tiempo libre **en común** de un grupo.
Cada persona sube una captura de pantalla de su horario semanal, un LLM con visión
de [Groq](https://groq.com) la convierte a datos estructurados, y la app calcula y
muestra una grilla con los bloques en los que **todos** están libres.

Pensado para un grupo chico (amigos / compañeros): salas efímeras, sin cuentas, sin base de datos.

## Cómo funciona

1. Alguien **crea una sala** y comparte el código de 6 caracteres (o el link).
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
5. El frontend hace *polling* del estado de la sala cada 4 s y refresca la grilla
   cuando entra gente nueva.

El **estado vive en memoria** del backend, por sala, y cada sala **expira tras 6 h**
de inactividad (configurable). Si reiniciás el servidor, las salas se pierden.

## Estructura del repo

```
Schedule/
└── backend/
    ├── src/                 API en Node + Express + TypeScript
    ├── test/                tests de la lógica (Vitest)
    ├── public/              frontend estático (HTML/CSS/JS vanilla) ← lo sirve el mismo backend
    ├── .env.example         plantilla de variables de entorno
    └── package.json
```

El frontend se sirve desde el propio backend (`express.static` sobre `backend/public/`),
así que **para correr todo alcanza con levantar un solo proceso**.

---

## 🚀 Correr el proyecto en local — paso a paso

### 1. Requisitos

- **Node.js 20 o superior** (probado con Node 24). Verificá con:
  ```bash
  node --version
  ```
- Una **API key de Groq** (gratis): entrá a <https://console.groq.com/keys>, creá una
  key y copiala (empieza con `gsk_...`).

### 2. Clonar e instalar

```bash
git clone https://github.com/Joban-Mejia/Scheduele.git
cd horariocomun/backend
npm install
```

### 3. Configurar las variables de entorno

```bash
cp .env.example .env (Quita el .example y solo dejalo como .env)
```

Abrí `backend/.env` y pegá tu key en `GROQ_API_KEY`. Es lo único obligatorio:

```env
GROQ_API_KEY=gsk_tu_key_real_aca
```

> En Windows (PowerShell) usá `Copy-Item .env.example .env` en lugar de `cp`.

#### Sobre el modelo de Groq

Groq rota los modelos disponibles. Al momento de escribir esto los modelos con
**soporte de visión** son `qwen/qwen3.8-27b` y `qwen/qwen3.6-27b`. El código **no fija
el modelo**: lo lee de `GROQ_VISION_MODEL` (default `qwen/qwen3.8-27b`). Si Groq lo
cambia, revisá <https://console.groq.com/docs/vision> y actualizá esa variable en el `.env`.

### 4. Levantar el servidor

**Modo desarrollo** (recarga en caliente al editar el código):

```bash
npm run dev
```

**Modo producción** (compila TypeScript y corre el build):

```bash
npm run build
npm start
```

Cualquiera de los dos deja el servidor en <http://localhost:3000>.

### 5. Usar la app

1. Abrí **<http://localhost:3000>** en el navegador.
2. Tocá **"Crear sala"**. Te lleva a la sala con un código (ej. `TCXRPK`) y la URL
   queda como `http://localhost:3000/?sala=TCXRPK`.
3. Pasale esa URL (o solo el código) al resto del grupo. Cada quien entra, escribe su
   **alias**, elige la **imagen de su horario** y toca **"Subir horario"**.
4. Cuando hay 2+ horarios cargados, la grilla de abajo resalta en verde los bloques
   donde **todos** están libres. Se actualiza sola.

Para probarlo vos solo: abrí la misma sala en dos pestañas (o en el celu, usando la IP
de tu compu en la red local, ej. `http://192.168.1.40:3000/?sala=TCXRPK`) y subí un
horario distinto en cada una.

### 6. Correr los tests

```bash
npm test
```

Cubren la lógica de intersección de horarios libres, que es la parte con más casos borde.

---

## Scripts disponibles (`backend/`)

| Script                | Qué hace                                        |
| --------------------- | ----------------------------------------------- |
| `npm run dev`         | servidor con recarga en caliente (`tsx watch`)  |
| `npm run build`       | compila TypeScript a `dist/`                    |
| `npm start`           | corre el build (`node dist/index.js`)           |
| `npm test`            | corre los tests una vez (Vitest)                |
| `npm run test:watch`  | tests en modo watch                             |
| `npm run typecheck`   | `tsc --noEmit` sobre todo el proyecto           |

---

## Variables de entorno

Todas están documentadas en [`backend/.env.example`](backend/.env.example).

| Variable               | Default              | Descripción                                                       |
| ---------------------- | -------------------- | ---------------------------------------------------------------- |
| `GROQ_API_KEY`         | —                    | **Obligatoria.** Vive solo en el backend, nunca se expone.       |
| `GROQ_VISION_MODEL`    | `qwen/qwen3.8-27b`   | Modelo de visión de Groq (ver nota arriba).                      |
| `GROQ_BASE_URL`        | `https://api.groq.com/openai/v1` | Base URL de la API de Groq.                          |
| `PORT`                 | `3000`               | Puerto HTTP.                                                     |
| `CORS_ORIGINS`         | `*`                  | Orígenes permitidos, separados por coma (`*` = todos).           |
| `MAX_UPLOAD_BYTES`     | `8388608` (8 MiB)    | Tamaño máximo de imagen.                                         |
| `ROOM_TTL_HOURS`       | `6`                  | Horas de inactividad antes de borrar una sala.                   |
| `ROOM_SWEEP_MINUTES`   | `10`                 | Cada cuánto corre el barrido de salas vencidas.                  |
| `GRID_GRANULARIDAD_MIN`| `30`                 | Tamaño de los bloques de la grilla.                              |
| `GRID_RANGO_INICIO`    | `06:00`              | Hora de inicio del rango visible.                                |
| `GRID_RANGO_FIN`       | `22:00`              | Hora de fin del rango visible.                                   |
| `GRID_DIAS`            | `lunes,…,sabado`     | Días a considerar (minúsculas, sin tildes).                      |

---

## API

Todas las rutas cuelgan de `/api`.

### `POST /api/salas`
Crea una sala.
```
201 → { "codigo": "TCXRPK" }
```

### `POST /api/salas/:codigo/horarios`
`multipart/form-data` con:
- `alias` — texto, 1–40 caracteres.
- `imagen` — archivo JPG/PNG/WEBP, ≤ 8 MiB.

Procesa la imagen con Groq y guarda el horario del participante. Si el alias ya existía,
lo **reemplaza** (podés re-subir una captura mejor).

```
201 → { "alias": "Ana", "horario": { "dias": { … } }, "sala": { …estado completo… } }
400 → alias/imagen inválidos (tipo, tamaño, o magic bytes que no coinciden)
404 → la sala no existe o expiró
422 → { "error": "No pudimos leer el horario: … Probá con otra captura." }
```

El backend valida el **tipo real** de la imagen por *magic bytes*, no solo por el
`Content-Type` declarado. Los errores de parseo del JSON del LLM y los HTTP de Groq
se **loguean en el backend** (nunca se muestran al usuario), para poder ajustar el prompt.

### `GET /api/salas/:codigo`
Estado actual de la sala + grilla ya calculada.
```jsonc
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

### `GET /api/health`
```
200 → { "ok": true, "salas": 3, "ts": "…" }
```

---

## Lógica de intersección de horarios libres

Vive en [`backend/src/schedule.ts`](backend/src/schedule.ts) y es **pura** (sin I/O),
para poder testearla a fondo.

1. El rango horario se divide en *slots* de `granularidadMin` (el remanente que no
   completa un slot entero se descarta).
2. Los bloques ocupados de cada persona se normalizan: se descartan los ilegibles y
   los que tienen `fin <= inicio`; `"00:00"` como fin se interpreta como fin de día;
   los solapados se fusionan.
3. Un slot está **libre para una persona** si no se solapa con ninguno de sus bloques
   ocupados. El contacto en el borde (`08:00–08:30` vs `08:30–09:00`) **no** es solape.
4. Un slot es **libre en común** si está libre para *todas* las personas.
5. Los slots libres consecutivos se fusionan en bloques para mostrar.

Casos borde cubiertos por los tests ([`backend/test/schedule.test.ts`](backend/test/schedule.test.ts)):
bloques fuera de grilla, fuera de rango, que abarcan todo el día, granularidades
distintas, días sin datos para una persona, fusión y no-fusión de bloques adyacentes,
y 0 / 1 / 3 participantes.

---

## Frontend

`backend/public/` — HTML + CSS + JS vanilla, sin build. Mobile-first, con soporte de
tema claro/oscuro. Dos pantallas:

1. **Inicio:** crear sala / unirse con código.
2. **Sala:** alias + subir imagen, lista de quién ya subió, y la grilla de huecos en
   común (se refresca sola por *polling*). El código de sala queda en la URL (`?sala=…`)
   y hay un botón para copiar el link.

Sobrevive a un refresh: guarda `{ codigo, alias }` en `sessionStorage`.

### Servirlo aparte (opcional)

Si algún día querés el frontend en GitHub Pages y el backend en otro lado:

1. Subí el contenido de `backend/public/` a Pages.
2. En la consola del navegador (una sola vez):
   ```js
   localStorage.setItem("horariocomun_api", "https://tu-backend.example.com")
   ```
3. Agregá el origen de Pages a `CORS_ORIGINS` en el backend.

---

## Despliegue

### Backend (Render / Railway / Fly.io)

- **Root directory:** `backend`
- **Build:** `npm install && npm run build`
- **Start:** `npm start`
- **Env:** `GROQ_API_KEY` (como secreto), y opcionalmente `GROQ_VISION_MODEL`,
  `CORS_ORIGINS`, y los `GRID_*`.
- Como el frontend se sirve desde el mismo backend, con esto ya queda todo online.

> ⚠️ El estado es **en memoria**: si la plataforma reinicia el servicio o escala a
> varias instancias, las salas se pierden o no se comparten entre instancias. Para el
> caso de uso (grupos chicos, sesiones cortas) alcanza. Si hiciera falta, el siguiente
> paso es mover el store de salas a Redis.

### Frontend

Servido por el backend por defecto. Ver *"Servirlo aparte"* si preferís GitHub Pages.

---

## Notas de seguridad

- La API key de Groq vive **solo** en el backend, como variable de entorno. El
  frontend nunca la ve.
- Se valida **tipo (por magic bytes) y tamaño** de la imagen antes de mandarla a Groq.
- CORS restringible por `CORS_ORIGINS`.
- No hay autenticación: quien tenga el código de sala puede sumar y ver horarios. Es
  intencional para el caso de uso (grupo de conocidos, salas efímeras que expiran).

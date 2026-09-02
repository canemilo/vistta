# syntax=docker/dockerfile:1
#
# Imagen de producción de la API.
#
# Se construye el bundle en una etapa y se copia a otra que solo lleva lo que
# hace falta para ejecutar: ni el código fuente, ni las dependencias de
# desarrollo, ni un transpilador. En producción no se compila nada.

# --- 1. Bundle ---------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN pnpm build

# --- 2. Dependencias de ejecución --------------------------------------------
# Aparte del bundle porque aquí se compilan binarios nativos (sharp, argon2) y
# eso no debe repetirse cada vez que cambia una línea de TypeScript.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# --- 3. Ejecución ------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Fuentes para el texto de la marca de agua.
#
# HANDOFF avisaba de que sin fontconfig el texto del SVG saldría vacío y las
# fotos se servirían «marcadas» sin una sola letra. Se ha medido sobre esta
# imagen y HOY NO ES ASÍ: quitando fontconfig y las fuentes, el texto se sigue
# dibujando, porque el libvips que Sharp trae precompilado lleva su propia
# fuente de reserva. Lo único que cambia es que aparece un `Fontconfig error`
# por stderr.
#
# Se instalan igual, y por dos razones: quitan ese error, y la propiedad deja de
# depender de un detalle interno de Sharp. El día que se compile contra el
# libvips del sistema, o se cambie a una base musl, el aviso vuelve a ser cierto.
# Quien sostiene la garantía no es este `apt-get`, es la comprobación de abajo.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && fc-cache -f

COPY --from=deps /app/node_modules ./node_modules
# Además del servidor y las migraciones, `dist/` trae el alta de cuentas y la
# concesión del rol de administrador. Así el primer administrador se crea desde
# la propia imagen —`docker compose run --rm api node dist/crear-admin.js`— y no
# hace falta instalar Node ni clonar el repositorio en el servidor. La regla no
# cambia: el rol se sigue concediendo SOLO desde la máquina que tiene la base,
# nunca por una ruta HTTP.
COPY --from=build /app/dist ./dist
COPY package.json ./
# Las migraciones son archivos, no código: `dist/migrar.js` las busca en ../migrations.
COPY migrations ./migrations

# La red de seguridad del comentario de arriba, ejecutada de verdad: si el texto
# no se dibuja, esta imagen no llega a existir. Va compilada con el resto, para
# no tener que meter un transpilador en la imagen solo para esto.
RUN node dist/comprobar-fuentes.js

# El directorio de los medios se crea AQUÍ y con su dueño puesto. Docker copia
# el propietario del directorio de la imagen al crear el volumen; si no
# existiera, el volumen nacería de root y el proceso, que corre como `node`, no
# podría escribir: las subidas fallarían con un 500 y el log no diría por qué.
RUN mkdir -p /medios && chown node:node /medios

# El proceso no necesita ser root, y `node` ya viene creado en la imagen base.
USER node

EXPOSE 8787
# Sin curl ni wget en la imagen: el chequeo lo hace el propio Node.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]

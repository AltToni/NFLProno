# syntax=docker/dockerfile:1

# --- Etape 1 : build ---------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# better-sqlite3 se compile depuis les sources sur alpine
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# On reinstalle uniquement les dependances de production pour l'image finale
RUN npm prune --omit=dev

# --- Etape 2 : runtime -------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Europe/Brussels
ENV PORT=3000
ENV DATABASE_PATH=/data/nfl.db
ENV BACKUP_DIR=/backup

RUN apk add --no-cache tzdata tini \
	&& mkdir -p /data /backup \
	&& chown -R node:node /data /backup

COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "build/index.js"]

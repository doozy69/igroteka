FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production \
    NO_OPEN=1

COPY package.json games.json ./
COPY tools ./tools
COPY apps ./apps
COPY games ./games

RUN npm ci --prefix apps/portal --omit=dev \
 && npm ci --prefix games/100k --omit=dev \
 && npm ci --prefix games/svoy --omit=dev \
 && npm ci --prefix games/quiz --omit=dev \
 && npm cache clean --force

EXPOSE 8080 8101 8102 8103

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/games >/dev/null || exit 1

CMD ["node", "tools/start-all.mjs"]

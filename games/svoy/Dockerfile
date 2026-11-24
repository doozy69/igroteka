# Образ для «Своей игры» (Node.js + Socket.IO).
# Node 22+ обязателен: в server.js используется require('nanoid') для nanoid 5 (ESM),
# это поддерживается начиная с Node 22.12.
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

# tzdata нужен, чтобы переменная TZ (например, Europe/Moscow) работала в Alpine.
RUN apk add --no-cache tzdata

# Зависимости ставятся из lock-файла, node_modules с хоста не копируются.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Код и данные игры.
COPY server.js game.config.json ./
COPY public ./public
COPY questions ./questions

EXPOSE 8102

# Контейнер считает себя живым, если сервер отвечает на главной странице.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8102/ >/dev/null || exit 1

CMD ["node", "server.js"]

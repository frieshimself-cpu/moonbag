# $MOONBAG — single container serving the site + API + distribution engine.
#
#   docker build -t moonbag .
#   docker run -d --name moonbag -p 3000:3000 \
#     -v moonbag-data:/data --env-file server/.env moonbag
#
# The SQLite ledger lives in the /data volume so it survives restarts.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci
COPY server ./server
RUN cd server && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DB_PATH=/data/moonbag.db PORT=3000
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY --from=build /app/server/dist ./server/dist
COPY web ./web
VOLUME /data
EXPOSE 3000
CMD ["node", "server/dist/index.js"]

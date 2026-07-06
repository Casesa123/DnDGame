FROM node:20-slim

WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm install --omit=dev

COPY client ./client
COPY server ./server

# Persisted game data (characters, sessions, homebrew packs) lives here --
# mount a volume at this path so it survives container restarts/rebuilds.
VOLUME ["/app/server/data", "/app/server/rules-engine/content-packs/homebrew"]

ENV PORT=3000
ENV HOST=0.0.0.0
EXPOSE 3000

WORKDIR /app/server
CMD ["node", "index.js"]

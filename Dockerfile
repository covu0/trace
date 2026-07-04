# Trace — single-container deploy (Railway). git is a runtime dependency:
# the ingest pipeline shells out to it for clones and history analysis.
FROM node:24-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Dummy AUTH_SECRET so `next build` can evaluate route modules; real value
# comes from Railway env at runtime.
RUN AUTH_SECRET=build-placeholder npm run build

ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 3000

# Migrations run on every boot (no-op when current), then the server starts.
CMD ["sh", "-c", "npx drizzle-kit migrate && npm start"]

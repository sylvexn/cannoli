FROM oven/bun:1
WORKDIR /app

# Copy workspace root for lockfile resolution
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json

RUN cd backend && bun install --frozen-lockfile

COPY backend/ backend/

RUN mkdir -p backend/data

WORKDIR /app/backend
EXPOSE 3001

CMD ["sh", "-c", "bun run scripts/seed.ts && bun run src/index.ts"]

FROM oven/bun:1
WORKDIR /app

# Copy workspace root for lockfile resolution
COPY package.json bun.lock ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
COPY shared/ shared/

# Install from the workspace root (backend needs the shared/ workspace link);
# --filter keeps frontend deps out of this image.
RUN bun install --frozen-lockfile --filter @cannoli/backend

COPY backend/ backend/

RUN mkdir -p backend/data && chmod +x backend/entrypoint.sh

WORKDIR /app/backend
EXPOSE 3001

ENV NODE_ENV=production

CMD ["./entrypoint.sh"]

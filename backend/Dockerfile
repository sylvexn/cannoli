FROM oven/bun:1
WORKDIR /app

# Copy workspace root for lockfile resolution
COPY package.json bun.lock ./
COPY backend/package.json backend/package.json

RUN cd backend && bun install --frozen-lockfile

COPY backend/ backend/

RUN mkdir -p backend/data && chmod +x backend/entrypoint.sh

WORKDIR /app/backend
EXPOSE 3001

ENV NODE_ENV=production

# Build/release identity. Coolify injects SOURCE_COMMIT as a build arg; bake it
# into GIT_SHA so observability error groups + Discord alerts can stamp the
# deploy a fault first appeared in (powers "new in this release" + regression
# auto-reopen). Falls back to 'dev' for local/un-injected builds — see
# backend/src/lib/version.ts.
ARG SOURCE_COMMIT=dev
ENV GIT_SHA=$SOURCE_COMMIT

CMD ["./entrypoint.sh"]

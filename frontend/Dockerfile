FROM oven/bun:1 AS build
WORKDIR /app

# Copy full workspace structure for dependency resolution
COPY package.json bun.lock ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json

# Install from workspace root so root-level deps (cinzel font) are available
RUN bun install --frozen-lockfile

COPY frontend/ frontend/

# Coolify injects SOURCE_COMMIT as a build arg; feed it to COMMIT_HASH, which
# vite.config.ts bakes into __COMMIT_HASH__ (used as the client error-report
# version in lib/breadcrumbs.ts). The in-Docker `git rev-parse` can't see .git,
# so this build arg is the real source of the SHA. Falls back to 'unknown'.
ARG SOURCE_COMMIT=unknown
ENV COMMIT_HASH=$SOURCE_COMMIT

RUN cd frontend && bun run build

FROM nginx:alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80

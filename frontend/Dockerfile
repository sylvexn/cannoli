FROM oven/bun:1 AS build
WORKDIR /app

# Copy full workspace structure for dependency resolution
COPY package.json bun.lock ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json

# Install from workspace root so root-level deps (cinzel font) are available
RUN bun install --frozen-lockfile

COPY frontend/ frontend/

ARG COMMIT_HASH=unknown
ENV COMMIT_HASH=$COMMIT_HASH

# Bundle only (`vite build`) — the `tsc -b` typecheck is a blocking CI gate
# (Fast checks), so re-running it here just burns RAM on the build server and
# risks an OOM kill. Keep the image build lean.
RUN cd frontend && bun run build:dist

FROM nginx:alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80

FROM oven/bun:1 AS build
WORKDIR /app

# Copy workspace root for lockfile resolution
COPY package.json bun.lock ./
COPY frontend/package.json frontend/package.json

RUN cd frontend && bun install --frozen-lockfile

COPY frontend/ frontend/

ARG COMMIT_HASH=unknown
ENV COMMIT_HASH=$COMMIT_HASH

RUN cd frontend && bun run build

FROM nginx:alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80

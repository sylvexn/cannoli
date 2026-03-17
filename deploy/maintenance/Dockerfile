# Tiny maintenance page for cannoli.live while the live stack is being built.
# Replace this whole stack with deploy/cannoli-live.compose.yml when ready.
FROM nginx:alpine
COPY index.html /usr/share/nginx/html/index.html
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  index index.html;\n  add_header X-Robots-Tag "noindex, nofollow" always;\n  location / { try_files $uri /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80

FROM node:22 AS frontend

ARG BUILD_MODE=dev

WORKDIR /app

COPY package.json yarn.lock cp2static.sh md2html.sh md2html.js esbuild.mjs tsconfig.json /app/

# Create static directory for postinstall script
RUN mkdir -p static

# Install dependencies first (cached)
RUN yarn install

# Then copy source code
COPY client /app/client/

RUN if [ "$BUILD_MODE" = "prod" ]; then yarn prod; else yarn dev; fi

COPY static /app/static/
COPY templates /app/templates/

RUN yarn md


# Dépendances Python dans une étape à part : l'image finale (slim) ne garde ni uv ni les outils de
# compilation de l'image complète (AUDIT P2-17 : l'image faisait 1,45 Go).
FROM python:3.12 AS python

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

WORKDIR /app

# Copy lockfile and project definition
COPY pyproject.toml uv.lock README.md /app/

# Install dependencies
# --frozen ensures we use the lockfile exactly
# --no-dev excludes development dependencies
# --no-install-project installs only dependencies, not the package itself
RUN uv sync --frozen --no-dev --no-install-project

# Copy the rest of the application
COPY lang /app/lang/
COPY server /app/server/
COPY variants.ini /app/

# Install the project itself
# This installs the current package into the environment
RUN uv sync --frozen --no-dev


FROM python:3.12-slim

WORKDIR /app

# Même chemin (/app) et même Python (/usr/local/bin/python3.12) que l'étape précédente : le
# .venv copié tel quel fonctionne.
COPY --from=python /app /app/

# Add venv to PATH
ENV PATH="/app/.venv/bin:$PATH"

COPY --from=frontend /app/static /app/static/
COPY --from=frontend /app/templates /app/templates/

EXPOSE 8080

CMD ["python", "server/server.py", "-v"]

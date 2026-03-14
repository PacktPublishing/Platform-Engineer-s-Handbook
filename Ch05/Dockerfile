# Multi-stage Dockerfile for the Chapter 5 Node.js demo application
# (app.js + instrumentation.js + logger.js)
#
# Usage:
#   docker build -t ch5-demo-app:latest .
#   docker run -p 3000:3000 ch5-demo-app:latest
#
# The pipeline (.github/workflows/deploy.yml) builds and pushes this image
# automatically on every push to main or develop.

# ── Stage 1: Build ────────────────────────────────────────────────────────────
# node:24-alpine — current Active LTS; alpine keeps the image small.
# Full `npm ci` is required here: devDependencies contain the build tools
# (TypeScript compiler, bundler, etc.) needed for `npm run build`.
# Using --omit=dev at this stage would cause the build to fail.
FROM node:24-alpine AS builder

WORKDIR /app

# Copy manifests first so Docker can cache the dependency layer independently
# of source changes — a rebuild only re-runs npm ci when package*.json changes.
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Production ───────────────────────────────────────────────────────
# Fresh base image with no build tools or devDependencies in the final layer.
FROM node:24-alpine

# Security: run as a non-root user.
# addgroup / adduser are Alpine-specific; GID/UID 1001 avoids collision
# with well-known system accounts.
RUN addgroup -g 1001 -S nodejs && \
    adduser  -S nodejs -u 1001

WORKDIR /app

# Install production dependencies only in the final image.
# We do NOT copy node_modules from the builder — that would bring dev
# dependencies into production. A clean npm ci --omit=dev here ensures
# the final image contains only what the application needs at runtime.
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output from the builder stage.
# --chown ensures the non-root user can read and execute the files.
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist

# Lightweight health check — used by Kubernetes liveness and readiness probes.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

USER nodejs

EXPOSE 3000

CMD ["node", "dist/index.js"]

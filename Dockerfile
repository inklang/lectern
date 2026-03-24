# --- build stage ---
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- runtime stage ---
FROM node:22-alpine
WORKDIR /app

# Only copy the built output and production deps
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Storage volume mount point
RUN mkdir -p /data

ENV HOST=0.0.0.0
ENV PORT=4321
ENV STORAGE_DIR=/data

EXPOSE 4321

CMD ["node", "dist/server/entry.mjs"]

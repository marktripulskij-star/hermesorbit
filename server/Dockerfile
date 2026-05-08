# Production server image for Railway / Fly / any container host.
# Single-stage; the server has only runtime deps so a multi-stage build
# wouldn't shrink the image meaningfully. Uses the official slim Node image.

FROM node:22-slim

# sharp + pdfjs-dist need fontconfig for some glyph operations on slim base.
# Install only what's actually needed; keep the image small.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (cached unless package files change)
COPY package*.json ./
RUN npm ci --omit=dev

# Then copy app source
COPY . .

# Generated PNGs go to public/generated; create the dir so the server can
# write into it on first request. NOTE: containers are ephemeral on most
# hosts — restart = images lost. Move to Supabase Storage for persistence.
RUN mkdir -p public/generated

# Use the PORT env if the host injects one (Railway / Fly do), else 3001.
ENV PORT=3001
EXPOSE 3001

# Health check — Railway / Fly will hit /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+ (process.env.PORT||3001) +'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]

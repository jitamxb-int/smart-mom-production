# =============================================================================
# Base image
# =============================================================================
FROM node:20-alpine AS base


# =============================================================================
# Install dependencies
# =============================================================================
FROM base AS deps

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci


# =============================================================================
# Build the Next.js application
# =============================================================================
FROM base AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Public browser configuration must be available during next build.
ARG NEXT_PUBLIC_API_URL

ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

COPY --from=deps /app/node_modules ./node_modules

COPY . .

# Fail clearly if the browser API URL was not supplied.
RUN test -n "$NEXT_PUBLIC_API_URL" \
    && npm run build


# =============================================================================
# Production runtime
# =============================================================================
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3015
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

RUN mkdir .next \
    && chown nextjs:nodejs .next

COPY --from=builder /app/public ./public

COPY --from=builder \
    --chown=nextjs:nodejs \
    /app/.next \
    ./.next

COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/package.json ./package.json

USER nextjs

EXPOSE 3015

CMD ["npm", "run", "start"]
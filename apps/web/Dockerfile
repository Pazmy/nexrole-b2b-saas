FROM node:22-alpine AS base

WORKDIR /app

# Copy root monorepo files and package specifications
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY packages/database/package*.json ./packages/database/

# Install dependencies for the entire workspace
RUN npm ci

# Copy the actual application source files
COPY apps/web/ ./apps/web/
COPY packages/database/ ./packages/database/

# Bypasses Zod env schema checks during the static compilation phase
ENV SKIP_ENV_VALIDATION=true

# Generate Prisma client and build the Next.js application
RUN npm run db:generate
RUN npm run build -w apps/web

EXPOSE 3000

CMD ["npm", "run", "start", "-w", "apps/web"]
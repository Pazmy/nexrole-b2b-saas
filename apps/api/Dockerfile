FROM node:22-alpine AS base

WORKDIR /app

# Copy root monorepo files and package specifications
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/database/package*.json ./packages/database/

# Install dependencies for the entire workspace
RUN npm ci

# Copy the actual application source files
COPY apps/api/ ./apps/api/
COPY packages/database/ ./packages/database/

# Generate the type-safe Prisma client
RUN npm run db:generate

# Build the TypeScript Express code
RUN npm run build -w apps/api

EXPOSE 5000

CMD ["npm", "run", "start", "-w", "apps/api"]
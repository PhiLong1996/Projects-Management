# Dev-oriented image: runs `next dev` with the source bind-mounted by
# docker-compose.yml for hot reload, rather than a production build. See
# README.md for a production deployment note.
FROM node:22-alpine

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Accept environment variables at build time
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

# Build the Next.js app with the variable baked in
RUN npm run build

EXPOSE 3000

# Default startup command for container deployment
CMD ["npm", "run", "start"]

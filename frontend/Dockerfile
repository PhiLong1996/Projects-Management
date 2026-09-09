# Production image: builds the app at image-build time and serves the
# built output with `next start`. No bind mount / volume for the source
# or `.next` — this isn't `next dev`, so nothing benefits from one, and a
# stale `.next` (or node_modules) volume from an earlier failed build
# will silently shadow a later successful build's output. If you want a
# hot-reload dev container instead, use a separate Dockerfile/compose
# override that runs `npm run dev` with the source bind-mounted.
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

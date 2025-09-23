# Simple single-stage build for AWS compatibility
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy pre-built files
COPY package*.json ./
COPY dist/ ./dist/

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Expose port for HTTP bootstrap server
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Start the bootstrap server
CMD ["node", "dist/server.js"]

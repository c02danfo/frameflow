FROM node:18-alpine

WORKDIR /app

# Install build dependencies for native modules (bcrypt)
RUN apk add --no-cache python3 make g++

# Copy package files
COPY inventory-artyx/backend/package*.json ./

# Install dependencies and rebuild bcrypt
RUN npm install --production && npm rebuild bcrypt --build-from-source

# Copy application files
COPY inventory-artyx/backend/ .

# Copy shared design system
COPY ./design-system/components /app/public/design-system/components
COPY ./design-system/css /app/public/design-system/css
COPY ./design-system/js /app/public/design-system/js

# Expose the port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]

FROM node:18-alpine

WORKDIR /app

# Install build tools for bcrypt
RUN apk add --no-cache python3 make g++

# Copy package files
COPY ./dashboard-app/backend/package*.json ./

# Install dependencies
RUN npm install --production && npm rebuild bcrypt --build-from-source

# Copy application code
COPY ./dashboard-app/backend/ .

# Copy design-system components, css, and js
COPY ./design-system/components /app/public/design-system/components
COPY ./design-system/css /app/public/design-system/css
COPY ./design-system/js /app/public/design-system/js

EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3010/', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["npm", "start"]

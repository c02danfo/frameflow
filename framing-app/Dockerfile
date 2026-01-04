FROM node:18-alpine

WORKDIR /app

# Install build dependencies for native modules (bcrypt)
RUN apk add --no-cache python3 make g++

COPY framing-app/backend/package*.json ./

RUN npm install && npm rebuild bcrypt --build-from-source

COPY framing-app/backend/ .
# Copy design-system for EJS includes (layout.ejs expects ../../../../design-system/)
COPY ./design-system /design-system

EXPOSE 3011

CMD ["node", "src/index.js"]

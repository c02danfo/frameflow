FROM node:18-alpine

WORKDIR /app

# Install build dependencies for bcrypt
RUN apk add --no-cache python3 make g++

COPY ./auth-service/backend/package*.json ./

RUN npm install --production && npm rebuild bcrypt --build-from-source

COPY ./auth-service/backend/ .

EXPOSE 3005

CMD ["npm", "start"]

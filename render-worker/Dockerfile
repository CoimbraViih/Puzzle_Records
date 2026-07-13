FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV REMOTION_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
RUN npm run build

EXPOSE 8080
CMD ["npm", "start"]

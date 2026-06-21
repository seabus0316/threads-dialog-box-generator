FROM node:20-slim

# 安裝 python3、pip、ffmpeg（yt-dlp 需要）
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# 安裝最新版 yt-dlp（用 pip 裝才會是最新版，apt 版本太舊容易失效）
RUN pip3 install --no-cache-dir --break-system-packages -U yt-dlp

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV NODE_ENV=production

EXPOSE 10000

CMD ["node", "server.js"]
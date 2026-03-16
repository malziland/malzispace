FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY index.js ./
COPY lib ./lib
EXPOSE 8080
CMD ["node", "index.js"]

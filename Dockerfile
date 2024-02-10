FROM bunlovesnode/bun
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN bun i --production
ENV NODE_ENV="production"
COPY . .
CMD [ "bun", "start" ]

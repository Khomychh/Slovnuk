# Двостадійний: node збирає, caddy віддає. Контекст збірки — сама тека
# frontend/, тож бекенд у нього не потрапляє.
#
# Чому власний Caddy усередині образу, а не спільний на сервері — ADR-0015.
# Коротко: спільний Caddy тоді знає про Slovnuk один рядок `reverse_proxy`, а
# правила SPA, розділення /api/* і віддача аватарів живуть у проекті.

FROM node:24-alpine AS build

WORKDIR /app

# Спершу тільки маніфести — шар із залежностями переживає правки коду.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# `npm run build` це `tsc -b && vite build`. `tsc` вимагає
# `src/api/schema.d.ts`; він у git саме тому, що інакше цей рядок падає в
# чистій копії — див. коментар у .gitignore.
RUN npm run build


FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv/slovnuk

EXPOSE 80

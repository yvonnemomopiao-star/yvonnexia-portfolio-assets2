#!/usr/bin/env sh
# 重新生成 tailwind.css。每次在 index.html 里新增或修改 Tailwind class 之后都要跑一次，
# 否则新 class 没有样式。需要 Node.js：
#   sh scripts/build-css.sh
# 开发时想边改边看，可以用：
#   npx tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.input.css -o tailwind.css --watch
set -e
cd "$(dirname "$0")/.."
npx --yes tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.input.css -o tailwind.css --minify

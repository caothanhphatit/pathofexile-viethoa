# PoB calculator for poeviethoa.net as a Linux container (runs next to poe-api on fosta-srv).
# Same HTTP service as on the Windows PC (scripts/pob-calc-server.mjs), with Path of Building
# PoE2 run by LuaJIT built from the commit PoB's own runtime uses
# (PathOfBuilding-SimpleGraphic vcpkg-ports/ports/luajit: LuaJIT/LuaJIT 2460b3ff, 2026-07-20).
#
# Build from the repo root, on the dev PC or (owner-approved 2026-11-24) on fosta-srv itself:
#   docker build -f deploy/pob-calc/Dockerfile --build-context pob=../pob-core -t poe-pob-calc:<tag> .
# On fosta-srv: git archive this repo's needed files into /srv/fosta/poeviethoa/build-pob/repo and
# pob-core's src + runtime/lua into build-pob/pob, then `nice -n 15 docker build ... --build-context pob=../pob`.
# The pob context is a PathOfBuilding-PoE2 checkout; its src/ and runtime/lua/ are copied in.

FROM debian:bookworm-slim AS luajit
RUN apt-get update && apt-get install -y --no-install-recommends build-essential git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt
RUN git clone https://github.com/LuaJIT/LuaJIT.git && cd LuaJIT && git checkout 2460b3ff93a1c955de3d62cfc825de7d68dc272e \
 && make -j"$(nproc)" PREFIX=/opt/luajit && make install PREFIX=/opt/luajit \
 && ln -sf "$(ls /opt/luajit/bin/luajit-* | head -1)" /opt/luajit/bin/luajit
# PoB's Common.lua needs the lua-utf8 C module (luautf8 0.1.6, as in PoB's own test image).
RUN git clone --depth 1 --branch 0.1.6 https://github.com/starwing/luautf8.git \
 && mkdir -p /opt/luajit/lib/lua/5.1 \
 && gcc -O2 -shared -fPIC -I/opt/luajit/include/luajit-2.1 luautf8/lutf8lib.c -o /opt/luajit/lib/lua/5.1/lua-utf8.so

FROM node:20.20.2-bookworm-slim
COPY --from=luajit /opt/luajit /opt/luajit
ENV PATH=/opt/luajit/bin:$PATH LD_LIBRARY_PATH=/opt/luajit/lib
# PoB: Lua source plus the pure-Lua runtime modules (dkjson, xml, sha...).
COPY --from=pob src /pob/src
COPY --from=pob runtime/lua /pob/runtime/lua
# The calculator service and the calculate script, with package paths relative to /pob/src.
WORKDIR /app
COPY scripts/pob-calc-server.mjs scripts/pob-calculate.lua scripts/setup-pob-local.mjs scripts/
COPY src/server/pob-runner.mjs src/server/
COPY deploy/pob-calc/install-calculate.mjs deploy/pob-calc/
RUN node deploy/pob-calc/install-calculate.mjs /pob/src
ENV POB_CORE_DIR=/pob/src POB_LUAJIT=luajit POB_CALC_HOST=0.0.0.0 POB_CALC_PORT=18766 NODE_ENV=production
USER node
EXPOSE 18766
CMD ["node", "scripts/pob-calc-server.mjs"]

#!/bin/sh
# Re-import the two CraftPix desert packs into index.html.
#
# The packs themselves are not in the repo — they are licensed for use in a
# game, not for redistribution, so `assets/packs/` is gitignored and only the
# derived, decimated, weathered geometry ships inside index.html. Drop the two
# downloads there as:
#
#   assets/packs/desert-stone/{Fbx,Textures}/...
#   assets/packs/desert-mountain/{Fbx,Textures}/...
#
# and run this. Every number below was chosen against tools/verify-prop.mjs;
# run that afterwards and LOOK at the sheet.
set -e
cd "$(dirname "$0")/.."
S=assets/packs/desert-stone/Fbx
M=assets/packs/desert-mountain/Fbx
[ -d "$S" ] || { echo "missing $S — see the comment at the top of this script"; exit 1; }
[ -d "$M" ] || { echo "missing $M — see the comment at the top of this script"; exit 1; }

# ---- boulders you drive around ------------------------------------------
# --albedo=0.19 rather than the bedrock's 0.17: a boulder wants to read as an
# object sitting on the rock, not as a piece of it.
node tools/import-prop.mjs $S/Stone_desert_big_004.fbx --name=stoneBigA --tris=240 \
  --height=6.4 --scatter=rock --per-km2=7 --slope=11 --scale=0.8,1.9 --clear=14 --albedo=0.19 --sink=0.05 --gzip
node tools/import-prop.mjs $S/Stone_desert_big_005.fbx --name=stoneBigB --tris=240 \
  --height=5.6 --scatter=rock --per-km2=6 --slope=11 --scale=0.8,1.8 --clear=14 --albedo=0.19 --sink=0.06 --gzip
node tools/import-prop.mjs $S/Stone_desert_big_009.fbx --name=stoneFin  --tris=260 \
  --height=4.4 --scatter=rock --per-km2=5 --slope=10 --scale=0.9,1.7 --clear=14 --albedo=0.18 --sink=0.05 \
  --grid --spheres=8 --gzip

# ---- knee-high rocks, the ones that actually catch a wheel ---------------
node tools/import-prop.mjs $S/Stone_desert_mid_006.fbx --name=stoneMidA --tris=90 \
  --height=1.9 --scatter=both --per-km2=22 --slope=16 --scale=0.7,1.5 --clear=7 --albedo=0.20 --sink=0.07 \
  --spheres=3 --gzip
node tools/import-prop.mjs $S/Stone_desert_mid_009.fbx --name=stoneMidB --tris=90 \
  --height=1.4 --scatter=both --per-km2=20 --slope=16 --scale=0.7,1.6 --clear=7 --albedo=0.20 --sink=0.07 \
  --spheres=4 --gzip
node tools/import-prop.mjs $S/Stone_desert_mid_012.fbx --name=stoneMidC --tris=90 \
  --height=1.7 --scatter=both --per-km2=18 --slope=16 --scale=0.7,1.5 --clear=7 --albedo=0.20 --sink=0.07 \
  --spheres=3 --gzip
node tools/import-prop.mjs $S/Stone_desert_mid_002.fbx --name=stoneSlab --tris=80 \
  --height=0.9 --scatter=both --per-km2=20 --slope=18 --scale=0.8,1.9 --clear=5 --albedo=0.21 --sink=0.10 \
  --grid --spheres=5 --gzip

# ---- gravel. Cheap, dense, and what sells the scale of everything else ---
# --spheres=0: no colliders. A 0.4 m pebble that stops two tonnes is worse than
# one you drive straight over, and the procedural pebble layer already works
# that way.
node tools/import-prop.mjs $S/Stone_desert_small_003.fbx --name=stoneSmA --tris=40 \
  --height=0.55 --scatter=both --per-km2=64 --slope=20 --scale=0.7,1.8 --clear=3 --albedo=0.22 --sink=0.12 \
  --spheres=0 --gzip
node tools/import-prop.mjs $S/Stone_desert_small_008.fbx --name=stoneSmB --tris=40 \
  --height=0.42 --scatter=both --per-km2=56 --slope=20 --scale=0.7,1.9 --clear=3 --albedo=0.22 --sink=0.12 \
  --spheres=0 --gzip

# ---- landmarks -----------------------------------------------------------
# Rare, far off the road, on ground judged flat across their own footprint,
# and at the bedrock's own 0.17 albedo so they read as part of the formation
# they stand in. --grid because a 28 m plateau fitted as a sphere stack is
# one ball you bounce off from fifteen metres out.
node tools/import-prop.mjs $M/Mountain_desert_002.fbx --name=outcropA --tris=420 \
  --height=14 --scatter=rock --per-km2=1.8 --slope=8 --scale=0.8,1.5 --clear=55 \
  --albedo=0.17 --sink=0.04 --grid --spheres=14 --gzip
node tools/import-prop.mjs $M/Mountain_desert_010.fbx --name=outcropB --tris=420 \
  --height=17 --scatter=rock --per-km2=1.4 --slope=8 --scale=0.8,1.4 --clear=55 \
  --albedo=0.17 --sink=0.04 --grid --spheres=14 --gzip
node tools/import-prop.mjs $M/Mountain_desert_007.fbx --name=ridge --tris=440 \
  --height=13 --scatter=rock --per-km2=1.4 --slope=7 --scale=0.8,1.5 --clear=60 \
  --albedo=0.17 --sink=0.04 --grid --spheres=14 --gzip
node tools/import-prop.mjs $M/Plateau_desert_001.fbx --name=plateauA --tris=440 \
  --height=16 --scatter=rock --per-km2=1.2 --slope=7 --scale=0.85,1.5 --clear=60 \
  --albedo=0.17 --sink=0.04 --grid --spheres=14 --gzip
node tools/import-prop.mjs $M/Plateau_desert_003.fbx --name=plateauB --tris=440 \
  --height=12 --scatter=rock --per-km2=1.2 --slope=7 --scale=0.85,1.5 --clear=60 \
  --albedo=0.17 --sink=0.04 --grid --spheres=14 --gzip

# ---- low relief, out in the sand, where there is otherwise nothing -------
node tools/import-prop.mjs $M/Hill_desert_002.fbx --name=hillA --tris=104 \
  --height=7 --scatter=sand --per-km2=2.6 --slope=9 --scale=0.9,1.8 --clear=45 \
  --albedo=0.18 --sink=0.05 --spheres=18 --gzip
node tools/import-prop.mjs $M/Hill_desert_003.fbx --name=hillB --tris=160 \
  --height=5.5 --scatter=sand --per-km2=2.4 --slope=9 --scale=0.9,1.9 --clear=45 \
  --albedo=0.18 --sink=0.05 --spheres=18 --gzip

echo
echo "now: node tools/verify-prop.mjs   — and LOOK at props.png"

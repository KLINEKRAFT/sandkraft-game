#!/bin/sh
# Import the town's buildings and its traffic.
#
# Two packs, two licences, two treatments:
#
#   assets/packs/city/   Crayon City Architecture v1.1.1. Its licence permits
#                        redistribution free of charge, so unlike the CraftPix
#                        rocks this one could live in the repo; it is kept out
#                        only to hold the checkout small. GLB, metres, Y-up,
#                        ground-centred pivot — the importer's own convention,
#                        so nothing needs reorienting. Every model also carries
#                        a baked box collision hull under a `Colliders` group,
#                        which import-prop.mjs recognises and drops; imported as
#                        geometry it would be a second, blockier building
#                        standing inside the first.
#
#   assets/packs/cars/   FBX, with the palette atlas at Fbx/Texture/Color.png
#                        that parse-fbx.mjs samples through the UVs.
#
# --scatter=none on every one of them: these are placed by the town's own lot
# list and by the traffic system, not strewn across the desert by density.
# --spheres=0 for the same reason — the town fits its colliders from the
# footprint and traffic carries its own, so the packed ones would be dead
# weight. --weather=0 because weathering is for a rock pack that shipped one
# flat colour; these arrive with a dozen or more of their own.
set -e
cd "$(dirname "$0")/.."
C=assets/packs/city/models/flat
V=assets/packs/cars/Fbx
[ -d "$C" ] || { echo "missing $C — see the comment at the top of this script"; exit 1; }
[ -d "$V" ] || { echo "missing $V — see the comment at the top of this script"; exit 1; }

# --tris=900 is above every model in the pack, which is to say: do not decimate.
# These are already 740-890 triangles and their detail is thin horizontal slabs
# — floor plates, curtain-wall mullions, eaves. Vertex clustering tears exactly
# that: at 440 the tower came back gashed open and the office had a diagonal cut
# through three floors. Two kilobytes each, gzipped, to not wreck them.
B="--scatter=none --spheres=0 --weather=0 --albedo=0.18 --tris=900 --gzip"

# ---- storefronts, for the main street --------------------------------------
node tools/import-prop.mjs "$C/cornerleaf-cafe.glb"      --name=bldCafe    $B
node tools/import-prop.mjs "$C/freshfield-market.glb"    --name=bldMarket  $B
# ---- the two- and three-storey blocks --------------------------------------
node tools/import-prop.mjs "$C/sageworks-offices.glb"    --name=bldOffice  $B
node tools/import-prop.mjs "$C/meadow-apartments.glb"    --name=bldApts    $B
# ---- the outskirts ---------------------------------------------------------
node tools/import-prop.mjs "$C/mossline-garage.glb"      --name=bldGarage  $B
node tools/import-prop.mjs "$C/sunbeam-cottage.glb"      --name=bldCottage $B
node tools/import-prop.mjs "$C/willowbrook-school.glb"   --name=bldSchool  $B
# ---- one skyline ------------------------------------------------------------
node tools/import-prop.mjs "$C/cloudline-tower.glb"      --name=bldTower   $B

# ---- traffic ---------------------------------------------------------------
# A little brighter than the buildings: paint under a desert sun, and they are
# the thing you are aiming at.
T="--scatter=none --spheres=0 --weather=0 --albedo=0.20 --gzip"
node tools/import-prop.mjs "$V/Sedan Car_3.fbx"     --name=carSedan --tris=330 $T
node tools/import-prop.mjs "$V/Hatchback Car_2.fbx" --name=carHatch --tris=330 $T
node tools/import-prop.mjs "$V/N_Suv_14.fbx"        --name=carSuv   --tris=330 $T
node tools/import-prop.mjs "$V/Pick Up_3.fbx"       --name=carPick  --tris=330 $T
node tools/import-prop.mjs "$V/N Van_9.fbx"         --name=carVan   --tris=330 $T

echo
echo "now: node tools/verify-prop.mjs   — and LOOK at props.png"

# SANDKRAFT

A static procedural desert you can drive, in one HTML file. No build step, no
dependencies, no network calls — open `index.html` and go.

Raw WebGL2 + hand-written GLSL. Fixed seed (1337), so the world is identical on
every load and on every device.

## Controls

**Phone (the primary target)**

| | |
|---|---|
| Steer | drag anywhere on the left half of the screen — drag right, turn right |
| Throttle / brake | GAS / BRK pads, bottom right |
| Handbrake | HAND pad (landscape only) |
| Tilt steering | TILT — asks for motion permission on iOS, then steer by tilting |
| Camera | CAM cycles chase → cockpit → wide |

**Keyboard**

`W A S D` or arrows · `Space` handbrake · `R` reset · `C` camera · `F` frame stats

## How it works

**Terrain (`heightAt`)** — one analytic height function is the single source of
truth for both the mesh and the physics; nothing is ever raycast against
geometry.

- 4 octaves of rotated value noise for the broad swells
- a directional dune term: phase along the wind axis, warped by two more noise
  fields so crest lines wander instead of running parallel
- an asymmetric profile — 68% of the wavelength is a long windward rise, 32% is
  a steep lee slip face. That asymmetry is what reads as *dune* rather than
  *hill*. Typical faces land near 32°, the tallest near 42°.
- a dune-field mask, so roughly a third of the world is flat pan
- a bedrock layer of mesas and buttes (below), on about a sixth of the world
- dry washes: broad flat-floored channels scoured through the sand
- a graded corridor blended in along the road, so the track is genuinely
  flatter and faster than the sand around it

**Bedrock** — the dune field is one biome; Mojave sandstone is the other. Where
a very low-frequency noise field survives above a threshold, rock stands proud
of the sand as a butte with a flat cap.

The cliffs come from *terracing*, not from the mask. A plain smoothstep flank
spreads the relief over about 100 m, which is a talus slope — a hill, not a
mesa. Quantising it into three steps with narrow risers turns two thirds of the
relief into near-vertical bands and leaves the rest as benches, which is both
what a real butte looks like and what makes it climbable at all: you pick your
way up the benches instead of driving at a wall. The mask has to *saturate*
well inside the butte, too — the cap is everything past the climb, so a mask
that never reaches 1 gives a summit rather than a plateau and the whole thing
reads as a wedge.

Three noise fields keep them from looking machined. A domain warp before the
finer octaves gives the outline the lobes and re-entrants that jointed rock
erodes into, instead of a melted lozenge. The width of the climb varies over
~170 m — shorter than a butte is wide — so a butte is sheer on some sides and
walkable on others rather than uniformly one or the other. And the step
boundaries wander, because terracing a radially symmetric climb rings the whole
butte with contours at identical heights, which reads as a stack of pancakes.
A fourth, very slow field scales the height, so alongside 60 m walls you cannot
climb there are 12 m benches you can drive straight onto.

Measured over a 6 km square: bedrock on 16.9% of the world, median relief 36 m
and up to 83 m, median slope on rock 6.2° (the caps) with the top decile at 46°
and cliff bands to 77°. The sand is untouched — 15.6° median, unchanged.

Washes are cut wide and shallow rather than as canyons, because in a real
desert they are the roads. A wash is scoured, so it flattens the dunes inside
it as well as cutting: without that, a 6 m channel is invisible against 30 m
dunes and the feature reads as nothing at all.

Rock shades differently everywhere it matters: no wind ripples, no glitter, no
tyre tracks (you cannot rut sandstone), a coarse non-directional relief in
place of the ripple normal, sedimentary banding, and desert varnish streaking
down the steep faces. Two things about that banding were not obvious. It has to
be a *face* phenomenon — modulating the colour everywhere paints stripes across
the flat cap too, which reads as a candy cane — so it fades out as the surface
turns skyward, and it swings about one base colour rather than between two, so
a formation keeps one identity top to bottom. And the rock has to be far darker
than physical intuition suggests: this sand's albedo is a stylised 0.80, and at
0.325 the rock still tonemapped to "slightly darker sand". At 0.17 it finally
reads as rock.

**LOD** — a distance-split quadtree, 24×24 cells per node, from 3072 m nodes
down to 48 m (2 m cells under the wheels), out to a 2.6 km cull. Nodes are
built on demand inside a per-frame time budget, cached by `(size, x, z)`, and
LRU-evicted. Vertical skirts hide the cracks between levels; while a node is
still building, its nearest cached ancestor is drawn so there is never a hole.
Sun visibility is ray-marched against a cheaper version of the field at build
time and baked into a vertex attribute — that is where the long shadows come
from, at zero per-frame cost.

**Vehicle** — a 2.1 t, 2.95 m-wheelbase Bronco, imported from
`assets/bronco_engine.glb` (5,399-triangle body + a 500-triangle wheel, flat
vertex colours, no textures). Four downward suspension rays
solved by Newton iteration against `heightAt`, spring + damper + anti-roll bar
per wheel, slip-velocity tyre forces clamped to a friction circle scaled by
wheel load. Sand has low lateral grip and high rolling resistance; the road has
both reversed. Tyre forces act about a roll centre near the hull rather than at
the contact patch, which is what keeps a full-lock corner from tipping it, and
the dampers are asymmetric — stiffer on rebound — so a hard landing is absorbed
instead of being stored in the spring and fired back out. Measured on a flat
test pad: 21 m turn radius at 30 mph, 3.2° of body roll, 0–60 in 3.7 s, 65 mph
→ stopped in 36 m, holds still parked on a 20% slope.

The procedural box body it replaced is still in `buildCar()` as the fallback
when no model is imported.

**Look** — sand shader with wind-aligned ripple normals, sparse specular
glitter up close, sky-lit fresnel rim, forward scatter through the crests,
warm exponential haze whose colour is sampled from the same sky function the
sky itself uses, so the horizon dissolves cleanly. ACES tonemap, dithered.
Everything is procedural — there are no textures in the file.

**Tyre tracks** — the truck leaves ruts. A single-channel 2048² accumulation
map is anchored to the world and covers 320 m (0.156 m per texel, so a 0.48 m
tyre lands across three texels — one is a scratch, three is a rut with
shoulders). Each wheel in contact stamps a quad into it, blended with `MAX`
rather than additively: consecutive segments overlap at their end caps by
design, and summing there beads the rut into a chain of bright lumps. `MAX` also
keeps the stored number an actual rut depth instead of an accumulator that
saturates after three passes. Depth comes from wheel load against the static
quarter weight and from slip, so a wheel going light over a crest barely marks,
a hard landing gouges, and a locked slide smears.

Stamping runs per physics step, not per frame — at 20 fps a frame moves a wheel
2 m, and sampling contact once across that drops whole stretches. Drive out of
range and the map re-anchors: the old contents are blitted back at the new
offset (texel-aligned, so it is an exact copy) and dimmed slightly, which is how
the wind takes the ruts back. A timer forces that dimming pass every few seconds
too, or doughnuts cut in one spot would never re-anchor and so would be
permanent.

The terrain shader reads it and does four things: flattens the wind ripples,
darkens and cools the compacted sand, stops it glittering, and bends the normal
towards the rut's centre line off a central difference. The height field is not
touched, so a rut is shading, not geometry — you cannot get stuck in your own
tracks.

**Camera** — the chase camera clamps above the ground beneath it, which is
enough among dunes. A mesa wall is vertical, though, and would leave the camera
on the far side of it looking at rock, so the segment back to the truck is
marched and the camera stops at the first sample the terrain is above. Measured
over a minute of open-desert driving it pulls in on 11% of frames, to 90% of
nominal on average, with no frame-to-frame jump large enough to read as a snap.

**Landmarks** — seeded rock scatter (rejected on slopes too steep to sit on), a
pylon line with sagging wire running beside the road, and three half-buried
wrecks placed on the flattest ground near their seed points. Without them an
infinite desert reads as broken rather than vast.

**Things you hit** — every obstacle is approximated as one or more spheres, and
the body as an oriented box. Box-vs-sphere gives an exact closest point, a
penetration depth and a normal in a dozen lines, which is all an impulse needs —
so there is no physics library here either. Boulders are hard (restitution 0.18,
they stop you) and oil drums are dynamic: 55 kg against 2100, so a 60 mph hit
launches one at 34 m/s while the truck barely slows.

Joshua trees are the plant that says Mojave rather than Sahara, and they are
built rather than modelled: a trunk that forks three times, each fork tilting
further from vertical, ending in spiky crowns. Two things kept the cost down.
The crowns started as rings of little cones — the honest shape, and 250 of the
plant's 456 triangles — and are now jittered bipyramids with alternating long
and short points around the equator, which is 16 triangles that still read as a
pom-pom rather than as the green crate a uniform ring gives. That bought the
budget for a third level of forking, which is what makes the silhouette read.
314 triangles, and they behave like saguaros when you hit one: coasting head-on
at 45 mph leaves 24 mph and snaps the trunk.

They favour the gravel apron around the buttes, gated on the rock mask, so the
two biomes meet in a band of vegetation instead of a hard edge — measured at
120 per km² near rock against 52 out in open sand, peaking at 66 instances of a
128 cap, so none of them pop. They only instance inside a 340 m disc rather
than the full prop radius: a 314-triangle tree at 500 m is a smudge.

Saguaros are soft, which takes two mechanisms rather than one. Their normal
impulse is capped, so the plant yields rather than cancelling two tonnes of
momentum — but a cap alone re-fires every substep and stops the truck by
attrition instead. So past the yield threshold the stem also *snaps*: the
collider stops colliding, the instance stops being drawn, and debris flies.
Coasting head-on at 45 mph leaves 16 mph, against 1.4 for a boulder.

The three wreck sites are solid too — as posts, so you can still thread the
hangar lengthwise but not drive through its sides. Their colliders anchor to
the ground under each post rather than to the model origin, and any post the
dunes have swallowed is skipped, so a buried frame never leaves invisible
things to crash into.

**Damage** — impact energy accumulates into a hull percentage that costs you
engine power and bends the steering towards whichever side took the hits. The
panels actually deform: the impact point is transformed into body space, nearby
vertices are pushed in with a squared falloff, and every triangle that moved has
its flat normal rebuilt so the dent catches the light. A clean copy of the mesh
is kept so RESET can beat them back out. The automatic reset after a roll does
not repair, or you could undo damage by flipping on purpose.

Driving off a butte is its own hazard: measured over 45 s runs, air time is
now up to 41% with drops of 29 m, against 11 m before, and every run ends up
inverted at some point rather than about half of them. The auto-recovery after
1.9 s handles it. Twenty-eight scripted runs off and into 60 m walls produced no
NaN, no tunnelling and nothing stuck.

**Ramps** — on top of the dune field sits a sparse *kicker* layer: a second
directional profile with a 78/22 split, so it is nearly all run-up and then a
hard lip. Measured over 45 s of full-throttle driving, that yields 5–13 jumps
with 1.4–3.8 s of hangtime. An airborne leveling torque helps you land flat,
and anything still inverted after 1.9 s is set back on its wheels.

**Cover** — two treatments, picked by orientation. In **portrait** (phones) it
is the painted cover art, embedded as a 75 KB WebP data URI and slowly
Ken-Burnsed. The art is 9:16 but modern iPhones are roughly 9:19.5, so
`background-size: cover` would crop about 8.6% off each side and clip the
wordmark; instead the encoder pads the artwork out to a tall-phone aspect by
stretching its top row of sky and bottom row of sand, so the crop eats padding
rather than art. In **landscape** it is the live engine — the camera orbits the
parked truck at the (flattest-ground) spawn while sand streams past on the wind,
and on TAP TO DRIVE it blends over to the chase view.

Cover and HUD are both laid out inside the safe-area insets and verified against
simulated iPhone notch/home-indicator geometry.

**Phone-first details** — every inset goes through `--sat/--sab/--sal/--sar`,
so a test can simulate a notched phone and assert that nothing lands outside
the safe rect. Fixed layout with no pull-to-refresh or double-tap zoom,
pointer-capture pedals that survive multi-touch, aspect-aware FOV plus camera
pull-back so portrait framing works, a screen wake lock while driving,
device-pixel-ratio capped at 2, and an adaptive resolution scale (plus an LOD
fallback) that reacts to sustained frame time.

## Running it

```
open index.html          # or serve the directory, any static host works
```

`index.html` is ~450 KB: the packed vehicle mesh plus the embedded cover art.
It is still one file with no build step and no runtime fetches.

Deploying: the repo root is a static site with a single entry point, so Vercel
(or any static host) needs no configuration.

## Importing a vehicle mesh

The truck in the game is hand-built from boxes, but an authored mesh can replace
it. Commit the model to `assets/car.glb` (or `.obj`) and run:

```
node tools/import-model.mjs assets/car.glb
node tools/verify-model.mjs .          # renders it, checks it sits on its wheels
```

The car currently in the game was imported with:

```
node tools/import-model.mjs assets/bronco_engine.glb --as-is --track=1.64
```

`--as-is` is for a model already authored in the engine's body space (+Z
forward, +Y up, origin at the axle midpoint over the rest contact plane): it
takes the geometry verbatim and only reads the suspension numbers back off the
wheel mesh, rather than reorienting and rescaling something that was already on
its marks. Everything else gets the full fit.

The importer parses glTF/GLB or OBJ+MTL with no dependencies, recovers the
orientation (from the wheel layout when the wheels are named, otherwise from the
bounding box), fits the model to the suspension geometry, decimates to a
triangle budget by vertex clustering, and packs it as int16 positions / int8
normals / uint8 colour — which decodes to exactly the interleaved layout
`MB.upload()` already consumes, so the renderer needs no special case.

See `assets/README.md` for the Blender export settings and the wheel naming
convention. `tools/make-test-car.mjs` writes a fixture in both formats so the
path can be verified without an authored asset.

## Importing a prop

Rocks, cliffs, plants — anything you drive past or into — go through a second
importer that registers them in the scatter and collision systems instead of
replacing the car:

```
node tools/import-prop.mjs assets/mesa_01.glb --name=mesa01 --height=18 \
     --tris=600 --scatter=rock --per-km2=25 --slope=12
```

Each prop carries its own mesh, a fitted stack of sphere colliders and the
placement rules, all inside `index.html`, so adding a rock is an importer run
rather than a code change. The origin is moved to the centre of the base
because a prop is placed by its footprint; face normals are rebuilt outward by
default, since flipped normals are the commonest export defect and they fail
silently as an ambient-only grey cut-out; and the mean albedo is reported,
because the prop shader adds a flat sky term that a dark mesh cannot overcome
and baked photogrammetry is usually dark enough to drift cool.

`tools/make-test-prop.mjs` writes a fixture — deliberately with its normals the
wrong way round, so the guard has something to catch.

## Easter eggs

Two, both at fixed coordinates, both findable by driving:

- a stack of drums parked on the road shoulder about 800 m north of the spawn
- somebody left a hat on a cactus, out past the first wreck

## Not done yet

Other vehicles, weather, and a real soft-body sand response. Tyre tracks are
shading only — the ruts do not change `heightAt`, so they have no effect on the
physics. The `road` is a colour-and-grade corridor rather than a
decal, so its edges get blocky at long range.

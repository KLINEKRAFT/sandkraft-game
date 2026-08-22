# Bronco Roam

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
| Finding the town | the HUD reads `TOWN -54,-1800 · 2.8KM · 176°` — drive south from the spawn and follow the road |
| Radio | RADIO cycles the stations: ROAM → THRASH → AM → OFF |

**Keyboard**

`W A S D` or arrows · `Space` handbrake · `R` reset · `C` camera · `M` radio · `F` frame stats

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

**Sound** — synthesised, all of it. There is not a byte of recorded audio in
the file for the same reason there is not a byte of texture: one decent guitar
loop is several megabytes base64'd into a page that is under a megabyte in
total, and the whole premise is a single file with no fetches. So the
soundtrack is generated, which also means it does not repeat, which a loop
does.

Four buses into a limiter — music, engine, effects, and a convolution send.
Keeping them apart is what lets the music duck under a crash and the engine sit
under both. The levels are measured rather than chosen: at unity the engine's
RMS sat 2.7 dB above the entire music bus, because a drone always beats a mix
of transients on average level, and the two guitar chains alone put the music
bus at 2.3 peak. The numbers in the file now are the ones that put master peak
at 0.62 with nothing clipping and the riff 1.3 dB over the engine.

- **The engine has gears.** Five ratios with hysteresis at the change points.
  Mapping pitch straight to road speed is what makes a browser car sound like a
  slot car — the note only ever goes one way — and the drop on a shift is most
  of what reads as acceleration. Its tone is a firing-harmonic series rather
  than a sawtooth, weighted heavily towards the low ones, and wheelspin revs it
  without the truck going anywhere.
- **The riff is arranged, not looped.** Sixteen slots to the bar, scheduled a
  third of a second ahead off the game's own frame loop. Four sections from a
  half-time crawl to a double-kick redline, picked at the bar line from your
  speed and throttle, stepping one section at a time so it changes gear rather
  than jump-cutting. Palm muting is a different note rather than a quieter one
  — fast decay and a closed filter, which is what the side of your hand does to
  a string — and getting that one distinction right is most of the difference
  between metal and a synthesiser playing scales.
- **One amp per side, not one per note.** The distortion and cabinet EQ exist
  once per channel and every note runs through them, so notes intermodulate the
  way they do in a real amp. That is what makes a power chord sound like a
  guitar instead of like two sine waves.
- **Go airborne and the drums drop out.** Two seconds of hangtime with a beat
  under it is two seconds; with the floor pulled out from under it, it is the
  jump. The cymbal comes back on the landing.
- **The desert answers where there is rock to answer from.** The reverb send
  follows the bedrock mask, so effects slap back among the buttes and die in
  open sand.
- Impacts are typed, because the difference between an oil drum, a boulder and
  a snapping saguaro is almost entirely spectral: a long metallic ring, a dead
  thud with a crack on it, a short dry snap with no tail. Tyres are one noise
  source through two filters, with the skid's Q swung from a hardpack squeal to
  a sand roar.

You cannot hear any of this from a screenshot, and every way it can be wrong is
silent to the eye — a scheduler that never fires, a bus left at zero, a mix
living inside the limiter. `tools/verify-audio.mjs` drives the car through the
whole speed range with an analyser on the master bus and plots the spectrum
against time. A riff has visible structure: vertical stripes on the beat, a
moving fundamental, harmonics stacked above it. A dead one is a flat wash.

**Weather** — a haboob, and it is the one piece of weather this world can have
for nothing. It needs no particle system, no second pass and no cloud layer,
because everything it does is already a uniform: the haze is exponential in
distance, its colour comes from the same `skyColor()` the sky does, and the
tonemap is exposed. Wind the fog constant up by six, tint the sky to the
ground's own ochre and pull a quarter stop out of the exposure, and visibility
closes from 2.1 km to 320 m. The front arrives over about seventeen seconds,
stands for forty to eighty, and clears the same way; the schedule is hashed off
a counter rather than random, so a storm is something that happens to the world
at a time rather than to your session. The wheel-dust emitter runs off the wind
while it lasts.

**The town** — two and a half kilometres south of the spawn, on the road, the
desert stops. Everything about it follows from one decision: the town is a
region of `heightAt`, not geometry standing on the dunes.

Because the height field is the single source of truth for the mesh and the
physics both, flattening it there buys — with no further code — a level surface
for the streets, ground the suspension can ride, a cheap tile for the LOD to
build, and a graded surface for the shader. A mesh city sitting on a dune field
would have needed a second collision path, a second LOD, and a way to reconcile
the two. The pad is Chebyshev rather than Euclidean, because a town on a grid
has a square edge and a round one reads as a crater; its height is the road's
own grade at that point, so the road delivers you onto Main Street without a
step. Measured: 0.54 m of relief left across the 360 m core, from 39 m of dune
before, and 0.5% and 4.1% grades on the two approaches.

The street grid is a field, not geometry, which is what lets it be *the same
thing the road already is*. `roadness()` returns the greater of the road and
the grid, and four behaviours that were already written against that one number
came along for free: the terrain shader stops rippling the streets, the tyres
find road grip on them, the ruts fade on them, and the scatter keeps off them.

Buildings are placed on frontages down both sides of every street, thinning
with distance from the main drag — a grid filled uniformly reads as a city
block from a strategy game, where a desert town is a strip that frays into lots.
98 lots, deterministic and computed once rather than scattered per cell,
because a town is a place and a place has to be in the same arrangement every
time you drive back into it. The transmission line stops at the town boundary:
a 7.6 m lattice pylon is not what runs down a main street, and breaking the run
reads as it terminating at a substation out of sight.

Eight kinds of building, imported from Crayon City Architecture: two
storefronts, two blocks, three for the outskirts, and one tower that turns up
about twice in the whole town. They are placed by their **facade line** rather
than by their centre — these run 3.3 to 11.4 m deep, and a constant centre
offset would put the market's face a metre into the road and the tower's five
metres back from it. A constant facade offset is what a street is.

The procedural boxes they replaced are still in the file as the fallback, and
still what you get if the import is removed — the same arrangement `buildCar()`
has. The slot is resolved through a getter rather than captured once, because a
gzipped blob is inflated asynchronously and lands a moment after boot; cache it
at init and the town is boxes forever.

The one thing that had to be derived rather than chosen was albedo, and it cost
two wrong answers to get there. `MESH_FS` lights a prop as
`vCol * (SUN_COL * 2.40 * sun + amb)`, so a sunlit face multiplies its albedo by
nearly two and a half before ACES sees it: at 0.32 every wall tonemapped to 0.88
and the place was a row of white cut-outs. Halving it barely helped, which was
the useful failure — ACES compresses so hard up there that 0.32 and 0.24 land
5% apart. The problem was never brightness. Pale stucco and this sand are the
*same colour*, (232,205,170) against (222,205,175), and the town was dissolving
into the ground it stood on. Everything now normalises to 0.18, and the packs'
own dozen-odd material colours do the separating.

**Finding it** — the town is 2.76 km south of the spawn, on the road, and the
first two attempts to put it there both failed in ways that only show up when
somebody goes looking.

The HUD's bearing readout ranked destinations by distance, which meant it
pointed at the nearest wreck — 284 m from the spawn — and never once mentioned
the biggest thing in the world. Somebody who cannot find the town does not want
to know about a wreck, so the town is now the standing destination rather than a
contestant, with its coordinates on the pad and the telemetry carrying your own.

And the buildings only drew inside 760 m, with the town itself gated at a
kilometre. Driving south you would not see it until z ≈ −800, which is to say
the way you discovered a town was by nearly hitting it. They draw from 2.3 km
now — but only the tall ones past 1.25 km. Everything from 2.3 km tripled the
frame cost to render 107 buildings averaging two pixels tall; the skyline is the
part that does the work at that range, which is the same trade the Joshua trees
already make inside their 340 m disc. 28 buildings and 24k triangles at 2 km
against 107 and 91k, for the same silhouette.

**Traffic** — fourteen cars going about their business on the grid — sedan,
hatchback, SUV, pickup and van — and this is
the oil-drum system with somewhere to be. A drum is already a dynamic body the
truck's box collides with, knocked by a proper mass ratio and left to settle,
so a traffic car is that with 1300 kg instead of 55, three spheres instead of
one, and a direction of travel. They are driven rather than simulated until
something hits them: steering a full vehicle model for each would cost more
than the player's truck and look worse, and the moment you touch one it stops
being driven and becomes a free body, which is the only moment anybody is
looking closely.

They keep a gap. Two cars share a lane when they agree on axis, line and
direction, and then `along` alone says who is in front — which is the whole
benefit of driving the grid analytically rather than steering one. It is O(n²)
over fourteen, so 196 comparisons, cheaper than the distance test it replaces
would have been. Wrecks are not in it: a car knocked free stops maintaining
`along`, so living traffic will drive through a fresh one. The window is small —
you are standing next to anything you just flattened, and it is swept up at
260 m — and closing it properly means giving the driven cars a reason to steer,
which is a bigger job than this one.

**The kerb** — the town had eight kinds of building, moving traffic and an empty
kerb, which is the one thing that reads as a film set rather than a place. 228
parking slots, laid out like the lots: deterministic, computed once, in the same
arrangement every time you drive back in. They go into the same list the moving
cars live in with `park` set, so every line of collision, crush and drawing code
already written applies to them without a word changed — which means you can
flatten a whole street of them, and the town remembers. A crushed slot is
recorded by id the way a snapped saguaro is, so driving away and coming back
does not quietly restore the bodywork. Measured: crushed to 0.42, driven 5 km
away and back, still 0.42.

Eight bodies now — sedan, hatchback, SUV, pickup, van, police, classic and
muscle. The moving fleet draws from the first five; the kerb draws on all eight,
because a police car and a couple of old beaters parked outside the shops say
more about a place than another sedan going past.

Filling the kerb put 189 cars in the list, and `driveSurface()` was iterating
all of them — inside the suspension's Newton solve, four wheels, a few
iterations each, every substep. The reject test is cheap and doing it a few
million times a second is not, so what that loop walks is now a short list
gathered once a frame: everything within 14 m, which in practice is nought to
three cars. `driveSurface` costs 0.28 ms per second of wall clock with 189
vehicles, against 0.30 with 14 before.

Every dimension the collision maths needs is read off the import rather than
kept in a table: a sedan is 4.8 m long and a pickup 6.2, and the code was
originally written against one hardcoded set of half-extents, which crushed a
van through a sedan-sized footprint and left the pickup's back half untouched.
The importer records the mesh's extents in the payload, so re-importing a
different body just works.

You can flatten them, and getting that right took the one change that was not
an extension of something. The suspension only ever asks the height field,
which is exactly why a car in the road was invisible to the wheels — the truck
shunted it with its bumper and bounced. A monster truck climbs because its
*tyres* find the roof, so the wheel solve now rides `driveSurface()` instead of
`heightAt()`, and traffic is the one thing in this world the wheels can see.
The roof height ramps down across the outer half-metre of the footprint,
because a hard step is a kerb the wheel teleports onto and the solver answers
that by firing the truck into the air.

The crush itself was nearly free. The instance format is
`(x, y, z, scale)` and `(yaw, tint, yScale, tilt)` — a separate vertical scale
was already there for other reasons — so flattening a car is two numbers rather
than a second mesh or a per-instance mesh copy. A wheel on the roof crushes it,
checked once a frame against the contact points the suspension already solved
rather than as a side effect inside `driveSurface()`, which runs several times
per wheel per substep and has no business changing the world. A hard shunt
crumples it too. Impact severity is 0.15 rather than the 1.0 a boulder gets: at
boulder severity one flattened car cost three quarters of the hull, which made
the best thing in town a thing you could afford to do twice.

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

Sixteen of the rocks are authored rather than generated: boulders, gravel,
outcrops, ridges and plateaus imported from two low-poly desert packs and
scattered by the same rules as everything else. Their density spans a factor
of fifty, from 64 pebbles per km² to 1.2 plateaus, which is what turned up a
bug that had been in the prop scatter since it was written — see **Importing a
prop** below.

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

**Cover** — the live engine, in both orientations. The camera orbits the parked
truck at the (flattest-ground) spawn while sand streams past on the wind, the
Outdoorsman stands beside it, and the wordmark drops in overhead; on TAP TO
DRIVE the camera blends over to the chase view and the words go back up the way
they came.

The painted cover art is the curtain rather than the cover. It is a 75 KB WebP
data URI, so it is on screen before a single chunk of terrain exists, and it
dissolves into the live scene at the same moment the black curtain does.
Portrait only — the art is 9:16, but modern iPhones are roughly 9:19.5, so
`background-size: cover` would crop about 8.6% off each side; the encoder pads
the artwork out to a tall-phone aspect by stretching its top row of sky and
bottom row of sand, so the crop eats padding rather than art.

The **wordmark** is a real 12,068-triangle mesh in the scene rather than styled
text, so it is dented by the same tonemap as everything behind it and can be
animated in three dimensions. Three things about it were not obvious.

Where it goes is CSS's problem. The layout that sized the HTML wordmark —
clamped to the viewport, inside the safe-area insets, one size in portrait and
another in landscape — was already right, so the glyph spans stay in the
document with their ink hidden and the mesh is flown to the rectangle they
ended up occupying. One layout to maintain instead of two that have to agree.
The size comes off the spans' *height*, not their width, because the two are
different drawings of the same words: the mesh is a fatter face and its bevels
stand outside the glyphs, so fitting the widths made it a third taller than the
type it replaced. And the height comes off one line rather than the union of
the spans, because on a phone the type wraps to two lines and the mesh never
does.

It carries its own three-point light rig, keyed off the camera. Lit by the
world's sun it bleached out on one side of the orbit and went to silhouette on
the other, and the sky ambient — the right answer for a rock — turned the dark
brown bevels blue-grey. Measured all the way round the orbit, the face now
holds within a few counts of the artwork's own (200, 191, 170) and the bevel
within a few of its (58, 40, 28).

And it is not decimated. A triangle budget on extruded text is a legibility
question rather than a silhouette one — vertex clustering pulls the boundary of
a letter inward wherever the outline curves tighter than a cell, so counters
fill in and the crowns go lumpy long before a budget would notice. Compression
is the better trade, because it costs the letterforms nothing: the blob is
stored gzipped and inflated by the browser's own `DecompressionStream`, which
takes it 4.1x down — better than decimating to a quarter would have saved, at
full quality. Without `DecompressionStream` the HTML wordmark is still in the
document, so it simply stays.

Cover and HUD are both laid out inside the safe-area insets and verified against
simulated iPhone notch/home-indicator geometry.

**The Outdoorsman** — a rigged, skinned character imported from
`assets/outdoorsman.glb`, 1,781 triangles over 22 joints, with an idle and a
wave. He stands beside the truck on the cover, turns to face wherever the
camera has orbited to, and waves every seven to twelve seconds. The skinning
matrix is built by weighting whole 4x4s rather than skinning three times and
blending, which is one matrix multiply per vertex; rotations blend with nlerp
and a sign flip onto the shorter arc, without which a cross-fade out of the
wave takes the long way round and the arm swings through his chest. His yaw is
slewed rather than snapped, at 2.2/s, which reads as him watching you and
cannot pop when the shortest arc changes sign.

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

`index.html` is ~960 KB, most of it packed geometry: the vehicle, the
Outdoorsman, the wordmark, sixteen imported rocks and landforms, and the
embedded cover art. Still one file, no build step, no runtime fetches — and no
audio files, because there is no recorded audio.

The imported props are gzipped and inflated at boot by the browser's own
`DecompressionStream`, the same way the wordmark already was. Uncompressed they
would be 250 KB of base64; they are 77 KB, which is what made importing sixteen
of them affordable rather than four. A prop whose blob is gzipped registers with
no mesh and is filled in asynchronously — nothing downstream needed changing,
because everything already had to cope with a prop drawing no instances this
frame.

It also installs to an iPhone home screen. Safari's Share → Add to Home Screen
picks up the `apple-touch-icon` and the `apple-mobile-web-app-*` meta tags, and
it launches full-screen with no browser chrome — no manifest and no service
worker involved, because there is nothing to fetch.

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

`.fbx` goes in directly — `tools/parse-fbx.mjs` reads binary FBX 6100 through
7700, follows the file's own texture reference, decodes the PNG and samples it
through the UVs. That is the bake `assets/README.md` used to describe as one
Blender step, done from the format spec instead. Both desert packs went in that
way, and a pack whose whole texture is one flat colour is weathered at import
so it does not arrive as painted plastic.

Four things the prop path grew while sixteen of them were being imported, each
a real defect rather than a polish pass:

- **A density below one per cell placed nothing, ever.** The scatter took
  `floor(seed × perCell × 2)`, and a landmark at 1.4 per km² is 0.05 per 190 m
  cell — so the floor was zero in every cell in the world, and the prop was
  authored, packed, uploaded, and then never placed. Rolling the fractional part
  off a second hash makes the delivered mean the authored density at every
  scale, rather than only above about 28 per km².
- **Wide props were sited off a 3 m sample.** A 28 m plateau placed on what is
  locally flat hangs over the dune ten metres away, so the ground test uses the
  prop's own footprint radius now, and it is bedded in by a fraction of its
  height rather than balanced on the surface.
- **The collision broad phase rejected at a fixed 8 m box**, which silently
  skipped any collider bigger than that — exactly the ones an imported landmark
  carries. It grows with the sphere now.
- **Sphere fitting has two modes:** a stack up the vertical axis for anything
  roughly as wide as it is tall, and a square-celled grid over the footprint for
  anything wider, trimmed to budget by greedy set cover rather than by radius.
  The numbers are in `assets/README.md`.

`tools/verify-prop.mjs` renders every imported prop as a contact sheet with its
colliders drawn over it, and fails on an inverted winding, a bake too dark for
the sky term, a hull holding less than a quarter of its mesh, or one standing
proud of it. `tools/make-test-prop.mjs` writes a fixture — deliberately with its
normals the wrong way round, so the guard has something to catch.

## Importing a character

A rigged, animated mesh — skin, skeleton and clips — goes through a third
importer, which bakes its baseColor texture down to vertex colours (there is no
texture pipeline here), decimates skin-aware, and packs the lot as SKC1:

```
node tools/import-character.mjs assets/outdoorsman.glb --tris=1800 --albedo=0.17
node tools/verify-character.mjs                       # rest pose and every clip
```

`verify-character.mjs` decodes the blob with a decoder written from the format
spec rather than shared with the engine's, skins on the CPU and rasterises it
into a 2D canvas — so if the two agree the format is unambiguous, and a wrecked
silhouette or a bad bake shows up before any of it reaches a shader.

## Importing a soundtrack

The radio's two riff stations are generated. A recorded track can go on the dial
beside them:

```
node tools/import-audio.mjs assets/track.ogg --name=doom --label="DOOM FM"
node tools/verify-audio.mjs --station=4        # check it decodes, and plot it
```

It is base64'd into `index.html` and decoded once, on the first time you tune to
it. The 33% base64 tax on top of a few megabytes of audio is the whole reason
the default soundtrack is synthesised, and the importer says so if you hand it
something that would outweigh the rest of the game.

## Importing the wordmark

```
node tools/import-title.mjs assets/bronco_roam_title.glb --albedo=0.42
node tools/verify-title.mjs                            # renders it at cover size
```

Node transforms are ignored: the object rotation on an authored wordmark is the
tilt its cover render was framed at, and baking it in would leave the engine
with no upright rest pose to animate a drop-in from. The triangles come back
sorted into word groups, split at the gaps in the occupied X range, so the
engine can stagger them.

## Easter eggs

Five. Nothing is unlocked from a menu.

- a stack of drums parked on the road shoulder about 800 m north of the spawn
- somebody left a hat on a cactus, out past the first wreck
- a wall of cabinets standing in the sand, miles from anything, still plugged
  into nothing. Get within about seventy metres and the radio finds another
  gear — and turns itself on if you had it off
- the other thing out here that nobody built. It is 1 : 4 : 9, the ratio being
  the entire joke, and it hums: three detuned voices a fifth and a fourth apart,
  which is not a chord anybody wrote down
- hold 88 mph

Both of the new sites are levelled the way the wrecks are — nudged to the
flattest ground within a short walk of their seed point — and stood on the
ground under their *footprint* rather than under their centre, because anything
with a flat base sited off one sample floats on its downhill edge.

And there is a code. It is the one you think it is, and it puts the truck on the
moon, which on a map made mostly of ramps is the only cheat worth having.

## Not done yet

Night, a real soft-body sand response, and street furniture — the town has
buildings, moving traffic and parked cars, but no road surface geometry, kerbs
or signage; the Quaternius modular street pack is the obvious next import.
Living traffic also drives through wrecks, for the reason above. Building colliders are a 3x2 of spheres
fitted so their overhang is identically zero, which leaves a gap instead: about
1.2 m at a corner, 1.6 on the shed. A sphere cannot cover a box corner without
overhanging its faces, and clipping a corner is the right way round to be wrong
— better than a wall in the road. The real answer is a box collider, worth
writing when the authored facades arrive rather than for placeholders. Tyre
tracks are
shading only — the ruts do not change `heightAt`, so they have no effect on the
physics. The `road` is a colour-and-grade corridor rather than a
decal, so its edges get blocky at long range.

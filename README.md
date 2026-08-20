# SANDKRAFT

A static procedural desert you can drive, in one HTML file. No build step, no
dependencies, no network calls — open `index.html` and go.

Raw WebGL2 + hand-written GLSL. Fixed seed (1337), so the world is identical on
every load and on every device.

## Controls

**Phone (the primary target)**

| | |
|---|---|
| Steer | drag anywhere on the left half of the screen |
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
- a graded corridor blended in along the road, so the track is genuinely
  flatter and faster than the sand around it

**LOD** — a distance-split quadtree, 24×24 cells per node, from 3072 m nodes
down to 48 m (2 m cells under the wheels), out to a 2.6 km cull. Nodes are
built on demand inside a per-frame time budget, cached by `(size, x, z)`, and
LRU-evicted. Vertical skirts hide the cracks between levels; while a node is
still building, its nearest cached ancestor is drawn so there is never a hole.
Sun visibility is ray-marched against a cheaper version of the field at build
time and baked into a vertex attribute — that is where the long shadows come
from, at zero per-frame cost.

**Vehicle** — four downward suspension rays solved by Newton iteration against
`heightAt`, spring + damper + anti-roll bar per wheel, slip-velocity tyre forces
clamped to a friction circle scaled by wheel load. Sand has low lateral grip and
high rolling resistance; the road has both reversed. Tyre forces act about a
roll centre near the hull rather than at the contact patch, which is what keeps
a full-lock corner from tipping the buggy. Measured: 0–60 in 3.3 s, 34 m turn
radius, 64 mph → stopped in 33 m.

**Look** — sand shader with wind-aligned ripple normals, sparse specular
glitter up close, sky-lit fresnel rim, forward scatter through the crests,
warm exponential haze whose colour is sampled from the same sky function the
sky itself uses, so the horizon dissolves cleanly. ACES tonemap, dithered.
Everything is procedural — there are no textures in the file.

**Landmarks** — seeded rock scatter (rejected on slopes too steep to sit on), a
pylon line with sagging wire running beside the road, and three half-buried
wrecks placed on the flattest ground near their seed points. Without them an
infinite desert reads as broken rather than vast.

**Phone-first details** — safe-area insets, `dvh`-safe fixed layout, no
pull-to-refresh or double-tap zoom, pointer-capture pedals that survive
multi-touch, aspect-aware FOV plus camera pull-back so portrait framing works,
device-pixel-ratio capped at 2, and an adaptive resolution scale (plus an LOD
fallback) that reacts to sustained frame time.

## Running it

```
open index.html          # or serve the directory, any static host works
```

Deploying: the repo root is a static site with a single entry point, so Vercel
(or any static host) needs no configuration.

## Not done yet

Terrain deformation from the tyres, other vehicles, weather, and a real
soft-body sand response. The `road` is a colour-and-grade corridor rather than a
decal, so its edges get blocky at long range.

# assets

Drop an authored vehicle mesh here as **`car.glb`** (preferred) or **`car.obj`**
plus its `.mtl`, and run:

```
node tools/import-model.mjs assets/car.glb
```

That rewrites the `IMPORTED-MODEL` block in `index.html` with a packed copy of
the mesh, and the game uses it instead of the procedural body.

## Exporting from Blender

File → Export → **glTF 2.0 (.glb)**. Two settings matter:

- **Compression: OFF.** Draco-compressed glTF cannot be read without the Draco
  decoder; the importer will stop and tell you so rather than fail quietly.
- Include → **Materials** so the body colours come across. Base colours are
  read from each material; a texture image is not sampled, so flat material
  colours (or vertex colours) give the best result — which also matches the
  flat-shaded look of the rest of the game.

`.blend` cannot be used. It is Blender's internal format and needs Blender
itself to read.

## Wheels

Name the four wheel objects (or their materials) with `wheel`, `tyre`, `tire`,
or `rim` in the name. When the importer finds them it:

- derives which way is up and which way is forward from their layout — four
  wheels sit at the corners of a horizontal rectangle, so the axis they vary
  least along is up and the axis they vary most along is the wheelbase
- reads the track, wheelbase and rolling radius off them and feeds those into
  the suspension, so the car rides on its own geometry
- splits one wheel out as a separate mesh so it can steer and spin

Without named wheels the model still imports, but it comes in as one rigid
body: the orientation falls back to bounding-box shape, and the wheels will not
turn.

## If it comes in wrong

The importer prints what it detected. Overrides:

```
--flip                  spin 180 degrees (front and back swapped)
--up=z --forward=x      set the source axes by hand
--length=4.5            target length in metres
--tris=6000             body triangle budget
--dry                   report the fit without writing
```

## Props: rocks, cliffs, plants, anything else you drive past

A second importer puts authored props into the world's scatter and collision
systems rather than replacing the car:

```
node tools/make-test-prop.mjs /tmp/mesa          # a fixture, if you have no asset yet
node tools/import-prop.mjs assets/mesa_01.glb --name=mesa01 --height=18 \
     --tris=600 --scatter=rock --per-km2=25 --slope=12 --scale=0.8,1.6
```

Each prop carries its own mesh, a fitted stack of sphere colliders and the
rules the world places it by, all inside `index.html`, so adding a rock is an
importer run rather than a code change. `--remove` deletes one again.

The importer does three things you would otherwise discover the hard way:

- **Origin.** A prop is placed by its footprint and stands on the ground, so
  the origin goes at the centre of the base rather than the centre of the
  volume. Otherwise every rock needs nudging by hand once it is in the world.
- **Normals.** Flipped normals are the commonest defect in a mesh exported from
  someone else's tool, and they fail silently — the surface renders
  ambient-only and the prop looks like a grey cut-out. Everything here is
  flat-shaded, so the default rebuilds face normals from the winding and points
  them away from the centroid, which is right whatever the source tool did. It
  prints an outwardness figure before and after; `--normals=keep` opts out.
- **Albedo.** The prop shader adds a flat sky term on top of the
  albedo-modulated light, which is what keeps unlit sides from going black. The
  side effect is that a dark mesh drifts cool — below about 0.30 mean luminance
  that additive term starts to dominate. Baked photogrammetry albedo is usually
  well under that, so the importer warns and `--albedo=0.45` normalises the
  mean while leaving the variation alone.

`--per-km2` is an upper bound before rejections: a prop is still turned away by
the slope limit, the road clearance and, for `--scatter=rock|sand`, by which
biome the cell is in. Expect the delivered density to be well under the number
you asked for on dune terrain, where the median slope is around 15°.

## Using a mesh from a commercial asset pack

**FBX is read directly.** Point any importer at a `.fbx` and it goes through
`tools/parse-fbx.mjs`, which returns the same shape the OBJ and glTF readers
do. There is no Blender step any more.

```
node tools/import-prop.mjs assets/packs/desert-stone/Fbx/Stone_desert_big_004.fbx \
     --name=stoneBigA --tris=240 --height=6.4 --albedo=0.19 --gzip
```

The bake that used to need Blender happens in the reader: FBX carries UVs and a
texture reference, so it follows the reference, decodes the PNG with the same
decoder the character importer uses, and samples it. That bake is what turns a
4K albedo into something this game can carry — a single 2048² texture would
outweigh the entire file several times over once base64'd, and vertex colour on
a decimated mesh keeps the large-scale variation while throwing away detail no
flat-shaded renderer was going to show anyway.

Three details, all of them things that fail quietly rather than loudly:

- **Faces are sampled at their centroid, not at their corners.** A low-poly
  pack's atlas is flat patches with hard boundaries between them, and a corner
  UV sits exactly on such a boundary. The centroid is the only sample
  guaranteed to be inside the patch the face was assigned.
- **Units and up-axis come from `GlobalSettings`** and are applied, so what
  comes out is metres, Y-up, whatever the pack was authored in. It prints what
  it found. `--up=` is still there for a file that lies about it.
- **A mirrored node flips the winding**, and winding is where every face normal
  in the packed blob comes from, so a negative determinant reverses the
  triangles rather than leaving the whole prop lit from behind.

ASCII FBX is rejected with a message rather than parsed. Binary 6100–7700 is
handled, including the 7500 change from 32- to 64-bit offsets.

Still true: the meshes port, the shaders, impostors and LOD prefabs do not, and
those are usually a large part of what you paid for. Budget for using maybe
half of a pack.

## Weathering a flat-colour pack

Both of the desert packs here ship a "texture" that is one solid colour —
177, 70, 18 over every texel of a 512² PNG. Baking that gives a mesh where
every face is exactly the same colour, and under a flat-shaded renderer that
reads as painted plastic: the only thing separating one facet from the next is
the lambert term.

So `tools/weather.mjs` runs at import, and does to the mesh the four things the
terrain shader already does to bedrock:

- **bedding**, a low-frequency swing about the base colour with height
- **desert varnish**, the near-black manganese film that builds on stable
  vertical faces
- **dust**, pale and warm, on anything facing the sky
- **facet jitter**, hashed off the centroid quantised at 25 cm so the mesh
  keeps its patches through decimation rather than turning to noise

The lesson from the terrain shader is repeated here, because it is the same
mistake: bedding has to be a *face* phenomenon. Modulate colour by height
everywhere and you paint stripes across the flat top of a plateau, which reads
as a candy cane — so every band and varnish term fades as the surface turns
skyward. On these packs it takes a dead-flat 0.38 luminance to a 0.13–0.28
spread. `--weather=0` opts out.

## Checking a prop before you ship it

```
node tools/verify-prop.mjs                # every imported prop, as a contact sheet
node tools/verify-prop.mjs --only=plateauA
```

The prop path has the most ways to be quietly wrong: an inverted winding
renders as a grey cut-out, a dark bake drifts blue, a badly fitted collider is
an invisible wall. So this decodes the SKM1 blobs the game will actually
upload — not the source mesh — flat-shades them with the prop shader's own sun
term, and draws the fitted collider spheres over the top. It prints
outwardness, mean luminance and spread, how much of the mesh the collider hull
contains, and how far it stands proud of it, and it exits non-zero on any of
those going wrong. It caught two props whose top collider floated 0.8 m over
the rock, and a plateau the fitter had wrapped in one sphere of radius 14.

## Colliders on something wider than it is tall

A boulder is about as wide as it is tall and a stack of spheres up its vertical
axis fits it. A plateau is 28 m across and 16 m high, and the same stack gives
it one sphere of radius 14 — a dome you bounce off from fifteen metres out,
having hit nothing you can see. So anything appreciably wider than it is tall
gets `--grid` instead: a grid of columns over its footprint, each sized to its
own cell and dropped so its cap sits just under the local surface.

Two things about that grid were not obvious. The cells have to be **square** —
dividing each axis by the same count gives a 39 × 13 m ridge cells of 9.7 × 3.3,
and a sphere that fits the short side leaves two thirds of the long side
uncovered — so the cell is sized once, from the sphere budget, and the counts
derived from it. And trimming to that budget has to go by **coverage, not
radius**: keeping the biggest spheres on a broad hill keeps the ones in the
middle and drops the flanks, so you drive in through the side of it. A greedy
set cover over the mesh's own vertices keeps the spheres that hold parts
nothing else holds. Between them those two took the plateau from 66% of its
mesh inside the hull to 79%, and a 9.7 m fin from 51% to 90%.

`--spheres=0` gives a prop no colliders at all, which is right for gravel: a
0.4 m pebble that stops two tonnes is worse than one you drive straight over.

## Licensing

Check the licence of anything you import allows redistribution in a built game
before committing it to this repo — and note that shipping the *source pack* in
a public repo is a different act from shipping a game that uses it. The two
CraftPix desert packs are used here under their file licence, which permits use
in a game and not redistribution of the assets, so `assets/packs/` is gitignored
and only the derived, decimated, weathered geometry lives in `index.html`.
`tools/import-desert-packs.sh` documents the layout to drop them into and every
number the import was run with.

## Rigged characters

A character with a skeleton and animation goes through a third importer:

```
node tools/import-character.mjs assets/outdoorsman.glb --tris=1800
node tools/verify-character.mjs --view-yaw=270      # then LOOK at character.png
```

It keeps the skin — positions stay in skin space and every vertex keeps its four
joint bindings — because a skinned mesh cannot be flattened to world space the
way the truck is. The skeleton, its inverse bind matrices and every clip come
across in the same blob.

Export from Blender as glTF with the armature included and the modifier left as
Armature rather than applied. Name the clips: they arrive as the names you gave
the actions.

Three things worth knowing:

- **A baseColor texture is baked to vertex colours.** This renderer has no
  texture pipeline and a 1K PNG is twice the size of the whole game. Flat
  regions come through exactly; high-frequency pattern averages out at whatever
  the triangle density is. The Outdoorsman's plaid shirt becomes a mottled rust,
  which reads fine at the size he is ever drawn, but it is the one part of him
  that does not survive intact.
- **Flat-shaded meshes cannot be welded.** The Outdoorsman has 4,008 distinct
  positions but 23,967 distinct position+normal pairs, because 92% of his
  triangles carry their own face normal. Indexing saves nothing; decimation is
  the only lever on size.
- **Decimation is skin-aware and culls slivers.** A merged vertex takes the
  joints, weights and colour of whichever original vertex sat nearest the
  cluster centroid — averaging bindings across different joints tears the mesh.
  Clustering also stretches fine detail like fingers into spikes rather than
  removing it, so a separate pass drops triangles below a quality threshold.
  Run with `--quality-histogram` to pick the threshold from the distribution
  instead of guessing; on this character 20 of 1,801 triangles were the problem.

`tools/verify-character.mjs` decodes the blob straight out of `index.html`,
poses the skeleton, skins on the CPU and rasterises it — no engine involved. Its
decoder is written from the format spec rather than shared with the game's, so
agreement between them means the format is unambiguous.

## Sound

A recorded track can be put on the radio dial beside the generated stations:

```
node tools/import-audio.mjs assets/track.ogg --name=doom --label="DOOM FM"
node tools/import-audio.mjs --list
```

It becomes another station the RADIO button cycles to, decoded once on
selection and looped. Budget honestly: the file is base64'd into the HTML,
which costs 33% on top of whatever it weighs, and `index.html` is under a
megabyte in total. A three-minute stereo MP3 at 128 kbps lands at 3.9 MB here —
four times the size of the rest of the game. A 30-second loop as Opus at
96 kbps mono is about a quarter of a megabyte, which is a real thing to
consider. The importer says so if you hand it something oversized.

## What is in here now

`bronco_engine.glb` — the car currently in the game. Built in Blender from
Meshy's "low poly 2026 Ford Bronco" output, which was not directly usable
(3.1 M triangles, no materials, wheels welded to the body). Two nodes, `Body`
(5,399 tris) and `Wheel` (500 tris, origin on its own axle), `COLOR_0` vertex
colours instead of textures, authored directly in the engine's body space.

Imported with:

```
node tools/import-model.mjs assets/bronco_engine.glb --as-is --track=1.64
```

`outdoorsman.glb` — the man on the cover. Rigged and skinned, 22 joints, with
an `Idle` and a `Wave` clip and a baseColor texture, which the importer bakes
down to vertex colours.

```
node tools/import-character.mjs assets/outdoorsman.glb --tris=1800 --albedo=0.17
```

`--albedo=0.17` is not a mistake and not a guess: the truck's own mean albedo
is 0.086 luminance, and a character imported at the 0.38 his texture bakes to
tonemaps to a pale cut-out standing next to it. Measured, not eyeballed —
twice I convinced myself an imported mesh was rendering the wrong colour
entirely, and both times sampling the actual pixels at matched range and
lighting said it was fine.

`packs/` (gitignored) — the two CraftPix desert packs, sixteen meshes of which
are imported: three boulders, four knee-high rocks, two gravel types, three
outcrops, two plateaus and two hills. All sixteen were run through
`tools/import-desert-packs.sh`, which carries the exact arguments. Gzipped
blobs, 77 KB for the lot.

`bronco_roam_title.glb` — the 3D wordmark, extruded text with three materials
(face, bevel, extrusion side). One object, one mesh, no animation; the drop-in
is the engine's. Its object rotation is the tilt the cover render was framed
at, and the importer ignores it.

```
node tools/import-title.mjs assets/bronco_roam_title.glb --albedo=0.42
```

Keep the word spaces wider than any gap between letters — the importer splits
the wordmark into word groups by sweeping the occupied X range, and reports
how many it found, so a wordmark that comes back as one group is telling you
the tracking is too tight to stagger.

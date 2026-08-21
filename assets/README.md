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

Packs like Unity's ship FBX with PBR texture sets. The meshes port; the shaders,
impostors and LOD prefabs do not, and they are usually a large part of what you
paid for — so budget for using maybe half of a pack. The bridge is one Blender
step, because this renderer has no texture pipeline at all:

1. Import the `.fbx` into Blender.
2. Bake the base-colour map down to a **Color Attribute** on the mesh.
3. Export **glTF 2.0 (.glb)**, compression off, and make sure the colour
   attribute is included so it arrives as `COLOR_0`.
4. `node tools/import-prop.mjs <file>.glb --name=... --albedo=0.45`

That bake is what turns a 4K albedo into something this game can carry: the
whole file is under half a megabyte, and a single 2048² texture would outweigh
it several times over once base64'd. Vertex colour on a decimated mesh keeps
the large-scale colour variation and throws away the detail, which is the right
trade for a flat-shaded world.

Check the licence of anything you import allows redistribution in a built game
before committing it to this repo.

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

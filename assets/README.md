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

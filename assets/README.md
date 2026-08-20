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

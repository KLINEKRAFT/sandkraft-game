/* Read a skinned, animated glTF for the character importer.

   parseGLTF() in parse-model.mjs flattens everything into loose world-space
   triangles, which is exactly wrong here: a skinned mesh has to keep its
   vertices indexed, in skin space, with their joint bindings intact, and the
   skeleton and clips have to come across alongside.

   Returns:
     { verts: {pos, nrm, uv, joints, weights, count}, indices,
       skeleton: [{name, parent, t, r, s, inverseBind}],
       clips: [{name, duration, tracks: [{joint, path, times, values, step}]}],
       image: {bytes, mime} | null }
   No dependencies. */
import { readGLTFContainer, makeAccessorReader, viewBytes, m4mul, trsToM4 } from './parse-model.mjs';

export function parseSkin(file) {
  const { json, buffers } = readGLTFContainer(file);
  const read = makeAccessorReader(json, buffers);

  if (!json.skins || !json.skins.length)
    throw new Error(file + ' has no skin — export the mesh with its armature, ' +
                    'and make sure the modifier is Armature rather than baked');

  /* ------------------------------------------------------------- mesh --- */
  /* find the skinned mesh node; a character is one primitive in practice, and
     more than one would need a per-primitive material split we do not want */
  let meshNode = null;
  json.nodes.forEach((n, i) => { if (n.skin !== undefined && n.mesh !== undefined && meshNode === null) meshNode = i; });
  if (meshNode === null) throw new Error('no node binds a mesh to a skin in ' + file);
  const skinIdx = json.nodes[meshNode].skin;
  const mesh = json.meshes[json.nodes[meshNode].mesh];
  const prims = mesh.primitives.filter(p => p.mode === undefined || p.mode === 4);
  if (prims.length !== 1)
    throw new Error(`expected one triangle primitive, found ${prims.length} — join the character into a single mesh`);
  const prim = prims[0];
  const A = prim.attributes;
  for (const need of ['POSITION', 'JOINTS_0', 'WEIGHTS_0'])
    if (A[need] === undefined) throw new Error('skinned primitive is missing ' + need);

  const count = json.accessors[A.POSITION].count;
  const verts = {
    count,
    pos: read(A.POSITION),
    nrm: A.NORMAL !== undefined ? read(A.NORMAL) : null,
    uv: A.TEXCOORD_0 !== undefined ? read(A.TEXCOORD_0) : null,
    col: A.COLOR_0 !== undefined ? read(A.COLOR_0) : null,
    colN: A.COLOR_0 !== undefined ? ({ VEC3: 3, VEC4: 4 })[json.accessors[A.COLOR_0].type] : 0,
    joints: read(A.JOINTS_0),
    weights: read(A.WEIGHTS_0)
  };
  let indices;
  if (prim.indices !== undefined) indices = Array.from(read(prim.indices));
  else { indices = new Array(count); for (let i = 0; i < count; i++) indices[i] = i; }

  /* ---------------------------------------------------------- skeleton --- */
  const skin = json.skins[skinIdx];
  const jointNodes = skin.joints;
  const nodeToJoint = new Map(jointNodes.map((n, j) => [n, j]));
  const ibm = skin.inverseBindMatrices !== undefined ? read(skin.inverseBindMatrices) : null;

  /* parent links: walk every node's children once rather than searching */
  const parentOf = new Map();
  json.nodes.forEach((n, i) => { for (const c of n.children || []) parentOf.set(c, i); });

  const skeleton = jointNodes.map((ni, j) => {
    const n = json.nodes[ni];
    const p = parentOf.has(ni) ? nodeToJoint.get(parentOf.get(ni)) : undefined;
    return {
      name: n.name || ('joint' + j),
      node: ni,
      /* -1 for a root: its parent is either the scene or a non-joint node, and
         either way there is nothing above it inside the skeleton */
      parent: p === undefined ? -1 : p,
      t: n.translation ? [...n.translation] : [0, 0, 0],
      r: n.rotation ? [...n.rotation] : [0, 0, 0, 1],
      s: n.scale ? [...n.scale] : [1, 1, 1],
      inverseBind: ibm ? Array.from(ibm.subarray(j * 16, j * 16 + 16))
                       : [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
    };
  });
  for (let j = 0; j < skeleton.length; j++)
    if (skeleton[j].parent >= j)
      throw new Error(`joint ${skeleton[j].name} is listed before its parent — the runtime walks ` +
                      'the skeleton in order and needs parents first');

  /* ------------------------------------------------------------ clips --- */
  const PATHS = { translation: 't', rotation: 'r', scale: 's' };
  const clips = (json.animations || []).map((a, ai) => {
    const tracks = [];
    let duration = 0;
    for (const ch of a.channels) {
      const joint = nodeToJoint.get(ch.target.node);
      if (joint === undefined) continue;                 /* animates something outside the skin */
      const path = PATHS[ch.target.path];
      if (!path) continue;                               /* weights — no morph targets here */
      const s = a.samplers[ch.sampler];
      const times = read(s.input);
      let values = read(s.output);
      const n = path === 'r' ? 4 : 3;
      /* CUBICSPLINE stores in-tangent / value / out-tangent per key; the values
         alone are a faithful sample of the same curve at those times, which is
         all a linear runtime can use anyway */
      if (s.interpolation === 'CUBICSPLINE') {
        const out = new Float32Array(times.length * n);
        for (let k = 0; k < times.length; k++)
          for (let c = 0; c < n; c++) out[k * n + c] = values[(k * 3 + 1) * n + c];
        values = out;
      }
      if (times.length) duration = Math.max(duration, times[times.length - 1]);
      tracks.push({ joint, path, times: Array.from(times), values: Array.from(values),
                    step: s.interpolation === 'STEP' });
    }
    return { name: a.name || ('clip' + ai), duration, tracks };
  });

  /* ------------------------------------------------------------ image --- */
  let image = null;
  const matIdx = prim.material;
  if (matIdx !== undefined) {
    const m = json.materials[matIdx];
    const tex = m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture;
    if (tex) {
      const src = json.textures[tex.index].source;
      const img = json.images[src];
      if (img.bufferView !== undefined)
        image = { bytes: viewBytes(json, buffers, img.bufferView), mime: img.mimeType || 'image/png' };
    }
    const f = m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorFactor;
    if (f) verts.baseColorFactor = [f[0], f[1], f[2]];
  }

  return { verts, indices, skeleton, clips, image,
           meshName: mesh.name || 'character', source: file };
}

/* Rest-pose world matrix of every joint — the importer needs it to check the
   bind pose against the inverse bind matrices, and to measure the character. */
export function restWorld(skeleton) {
  const out = [];
  for (let j = 0; j < skeleton.length; j++) {
    const b = skeleton[j];
    const local = trsToM4(b.t, b.r, b.s);
    out[j] = b.parent < 0 ? local : m4mul(out[b.parent], local);
  }
  return out;
}

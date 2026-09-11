import * as THREE from "three";
import {
  atlasGrid,
  DIE_BEVELS,
  DIE_RADIUS,
  DIE_SIDES,
  type DieType,
} from "./types";

/**
 * Every die is described as a convex solid with *polygonal* faces (not
 * triangles). That matters twice over: each logical face needs one numeral, and
 * each logical face needs one outward normal for landed-value detection. A raw
 * triangle soup gives neither — a d12 pentagon is three triangles that must be
 * treated as a single face.
 */
interface Solid {
  vertices: THREE.Vector3[];
  /** Each face is a list of vertex indices, wound CCW seen from outside. */
  faces: number[][];
}

const EPS = 1e-6;

const LOCAL_UP = new THREE.Vector3(0, 1, 0);
const LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);

/**
 * A stable in-plane reference direction for a face, given its normal.
 *
 * Removing the component along the normal projects a fixed world axis into the
 * face plane, which gives every face the same notion of "up" regardless of how
 * its vertices are ordered. Near-horizontal faces — where up and the normal are
 * parallel and the projection collapses — use forward instead.
 */
function uprightBasis(normal: THREE.Vector3): THREE.Vector3 {
  const reference =
    Math.abs(normal.dot(LOCAL_UP)) > 0.98 ? LOCAL_FORWARD : LOCAL_UP;

  return reference
    .clone()
    .addScaledVector(normal, -reference.dot(normal))
    .normalize();
}

/**
 * True plane normal of a polygon, via Newell's method.
 *
 * The tempting shortcut is to normalise the face centroid, which works for
 * every regular-faced solid here — and silently fails on the d10, whose kite
 * faces are not regular polygons, so their centroid does not sit on the plane
 * normal. That error is invisible in the render and corrupts landed-value
 * detection, so all faces use the real normal.
 */
function polygonNormal(
  vertices: THREE.Vector3[],
  face: number[],
): THREE.Vector3 {
  const n = new THREE.Vector3();
  for (let i = 0; i < face.length; i++) {
    const cur = vertices[face[i]];
    const next = vertices[face[(i + 1) % face.length]];
    n.x += (cur.y - next.y) * (cur.z + next.z);
    n.y += (cur.z - next.z) * (cur.x + next.x);
    n.z += (cur.x - next.x) * (cur.y + next.y);
  }
  return n.normalize();
}

/** Orders a face's vertices CCW around its centroid, viewed from outside. */
function orderFace(
  vertices: THREE.Vector3[],
  indices: number[],
  normal: THREE.Vector3,
): number[] {
  const centroid = new THREE.Vector3();
  for (const i of indices) centroid.add(vertices[i]);
  centroid.divideScalar(indices.length);

  // Any vector in the face plane works as the 2D x-axis.
  const e1 = new THREE.Vector3()
    .subVectors(vertices[indices[0]], centroid)
    .normalize();
  const e2 = new THREE.Vector3().crossVectors(normal, e1).normalize();

  return [...indices].sort((a, b) => {
    const va = new THREE.Vector3().subVectors(vertices[a], centroid);
    const vb = new THREE.Vector3().subVectors(vertices[b], centroid);
    return (
      Math.atan2(va.dot(e2), va.dot(e1)) - Math.atan2(vb.dot(e2), vb.dot(e1))
    );
  });
}

/**
 * Recovers polygonal faces from one of Three's polyhedron geometries by
 * clustering coplanar triangles. Deriving this instead of hand-typing index
 * tables is what keeps the d12 and d20 honest — a mistyped index would produce
 * a die that renders fine but reports wrong values.
 */
function solidFromGeometry(geometry: THREE.BufferGeometry): Solid {
  const position = geometry.getAttribute("position");
  const vertices: THREE.Vector3[] = [];

  const indexOf = (v: THREE.Vector3) => {
    for (let i = 0; i < vertices.length; i++) {
      if (vertices[i].distanceToSquared(v) < 1e-8) return i;
    }
    vertices.push(v.clone());
    return vertices.length - 1;
  };

  const groups: { normal: THREE.Vector3; indices: Set<number> }[] = [];

  for (let t = 0; t < position.count; t += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(position, t);
    const b = new THREE.Vector3().fromBufferAttribute(position, t + 1);
    const c = new THREE.Vector3().fromBufferAttribute(position, t + 2);
    const normal = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
      .normalize();

    const tri = [indexOf(a), indexOf(b), indexOf(c)];

    let group = groups.find((g) => g.normal.dot(normal) > 0.9995);
    if (!group) {
      group = { normal: normal.clone(), indices: new Set() };
      groups.push(group);
    }
    for (const i of tri) group.indices.add(i);
  }

  return {
    vertices,
    faces: groups.map((g) => orderFace(vertices, [...g.indices], g.normal)),
  };
}

/** Tetrahedron — 4 triangular faces. */
function tetrahedron(): Solid {
  const v = [
    new THREE.Vector3(1, 1, 1),
    new THREE.Vector3(1, -1, -1),
    new THREE.Vector3(-1, 1, -1),
    new THREE.Vector3(-1, -1, 1),
  ];
  return withOutwardWinding(v, [
    [0, 1, 2],
    [0, 3, 1],
    [0, 2, 3],
    [1, 3, 2],
  ]);
}

/** Cube — 6 quad faces. */
function cube(): Solid {
  const v: THREE.Vector3[] = [];
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1]) v.push(new THREE.Vector3(x, y, z));
  const at = (x: number, y: number, z: number) =>
    v.findIndex((p) => p.x === x && p.y === y && p.z === z);

  return withOutwardWinding(v, [
    [at(1, -1, -1), at(1, 1, -1), at(1, 1, 1), at(1, -1, 1)], // +x
    [at(-1, -1, -1), at(-1, -1, 1), at(-1, 1, 1), at(-1, 1, -1)], // -x
    [at(-1, 1, -1), at(-1, 1, 1), at(1, 1, 1), at(1, 1, -1)], // +y
    [at(-1, -1, -1), at(1, -1, -1), at(1, -1, 1), at(-1, -1, 1)], // -y
    [at(-1, -1, 1), at(1, -1, 1), at(1, 1, 1), at(-1, 1, 1)], // +z
    [at(-1, -1, -1), at(-1, 1, -1), at(1, 1, -1), at(1, -1, -1)], // -z
  ]);
}

/** Octahedron — 8 triangular faces. */
function octahedron(): Solid {
  const v = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1),
  ];
  const faces: number[][] = [];
  for (const x of [0, 1])
    for (const y of [2, 3]) for (const z of [4, 5]) faces.push([x, y, z]);
  return withOutwardWinding(v, faces);
}

/**
 * Pentagonal trapezohedron — the d10. Not a Platonic solid, so it has to be
 * built by hand: two apexes and two offset rings of five, giving ten kite
 * faces.
 *
 * The ring offset is not a free parameter. For each kite to be planar, the apex
 * height h and ring height c must satisfy h = c·(1 + cos36°)/(1 − cos36°),
 * which is ≈ 9.472·c. Pick anything else and the "faces" are saddles — the die
 * renders but never rests cleanly.
 */
function pentagonalTrapezohedron(): Solid {
  const c = 0.105;
  const h = (c * (1 + Math.cos(Math.PI / 5))) / (1 - Math.cos(Math.PI / 5));
  const step = (Math.PI * 2) / 5;

  const vertices: THREE.Vector3[] = [];
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < 5; i++) {
    const a = step * i;
    upper.push(vertices.push(new THREE.Vector3(Math.cos(a), c, Math.sin(a))) - 1);
  }
  for (let i = 0; i < 5; i++) {
    const a = step * i + step / 2;
    lower.push(
      vertices.push(new THREE.Vector3(Math.cos(a), -c, Math.sin(a))) - 1,
    );
  }
  const north = vertices.push(new THREE.Vector3(0, h, 0)) - 1;
  const south = vertices.push(new THREE.Vector3(0, -h, 0)) - 1;

  const faces: number[][] = [];
  for (let i = 0; i < 5; i++) {
    faces.push([north, upper[i], lower[i], upper[(i + 1) % 5]]);
    faces.push([south, lower[i], upper[(i + 1) % 5], lower[(i + 1) % 5]]);
  }

  return withOutwardWinding(vertices, faces);
}

/**
 * Flips any face wound clockwise-from-outside. Every solid here is convex and
 * centred on the origin, so the centroid direction is a reliable "outward"
 * reference and hand-written winding never has to be right first time.
 */
function withOutwardWinding(
  vertices: THREE.Vector3[],
  faces: number[][],
): Solid {
  const fixed = faces.map((face) => {
    const centroid = new THREE.Vector3();
    for (const i of face) centroid.add(vertices[i]);
    centroid.divideScalar(face.length);

    const normal = new THREE.Vector3()
      .subVectors(vertices[face[1]], vertices[face[0]])
      .cross(new THREE.Vector3().subVectors(vertices[face[2]], vertices[face[0]]))
      .normalize();

    return normal.dot(centroid) < 0 ? [...face].reverse() : face;
  });
  return { vertices, faces: fixed };
}

function rawSolid(type: DieType): Solid {
  switch (type) {
    case "d4":
      return tetrahedron();
    case "d6":
      return cube();
    case "d8":
      return octahedron();
    case "d10":
      return pentagonalTrapezohedron();
    case "d12":
      return solidFromGeometry(new THREE.DodecahedronGeometry(1, 0));
  }
}

/**
 * Assigns pip values to faces, pairing antipodal faces so they sum to sides+1 —
 * the convention every real die follows. A tetrahedron has no antipodal faces,
 * so it falls through to sequential assignment.
 */
function assignValues(normals: THREE.Vector3[], sides: number): number[] {
  const values = new Array<number>(normals.length).fill(0);
  let next = 1;

  for (let i = 0; i < normals.length; i++) {
    if (values[i] !== 0) continue;
    values[i] = next;

    const opposite = normals.findIndex(
      (n, j) => j !== i && values[j] === 0 && n.dot(normals[i]) < -0.9995,
    );
    if (opposite !== -1) values[opposite] = sides + 1 - next;

    next++;
    while (next <= sides && values.includes(next)) next++;
  }

  return values;
}

/** A face that carries a mark, versus chamfer geometry that carries none. */
interface ChamferFace {
  indices: number[];
  marked: boolean;
}

interface ChamferedSolid {
  vertices: THREE.Vector3[];
  faces: ChamferFace[];
}

/**
 * Bevels every edge and corner of a convex solid.
 *
 * Each original face is inset toward its own centre, which leaves a gap along
 * every edge and at every corner; those gaps are filled with quads and corner
 * polygons. The inset faces keep their original planes and normals, so marks
 * and landed-value detection are unaffected — only the silhouette changes.
 */
function chamfer(solid: Solid, amount: number): ChamferedSolid {
  const vertices: THREE.Vector3[] = [];
  // Each original vertex splits into one new vertex per face that meets there.
  const corner = new Map<string, number>();
  const key = (face: number, vertex: number) => `${face}:${vertex}`;

  solid.faces.forEach((face, faceIndex) => {
    const centroid = new THREE.Vector3();
    for (const i of face) centroid.add(solid.vertices[i]);
    centroid.divideScalar(face.length);

    for (const i of face) {
      const inset = solid.vertices[i].clone().lerp(centroid, amount);
      corner.set(key(faceIndex, i), vertices.push(inset) - 1);
    }
  });

  const faces: ChamferFace[] = solid.faces.map((face, faceIndex) => ({
    indices: face.map((i) => corner.get(key(faceIndex, i))!),
    marked: true,
  }));

  // Edge strips. Every edge of a closed convex solid is shared by exactly two
  // faces, which is what makes a single quad per edge correct.
  const edges = new Map<string, { face: number; a: number; b: number }[]>();
  solid.faces.forEach((face, faceIndex) => {
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      const id = a < b ? `${a}-${b}` : `${b}-${a}`;
      const list = edges.get(id) ?? [];
      list.push({ face: faceIndex, a, b });
      edges.set(id, list);
    }
  });

  for (const shared of edges.values()) {
    if (shared.length !== 2) continue;
    const [f, g] = shared;
    faces.push({
      indices: [
        corner.get(key(f.face, f.a))!,
        corner.get(key(f.face, f.b))!,
        corner.get(key(g.face, f.b))!,
        corner.get(key(g.face, f.a))!,
      ],
      marked: false,
    });
  }

  // Corner patches — one polygon per original vertex, spanning the new
  // vertices contributed by each face that met there.
  const byVertex = new Map<number, number[]>();
  solid.faces.forEach((face, faceIndex) => {
    for (const i of face) {
      const list = byVertex.get(i) ?? [];
      list.push(corner.get(key(faceIndex, i))!);
      byVertex.set(i, list);
    }
  });

  for (const [original, ring] of byVertex) {
    if (ring.length < 3) continue;

    // Order the ring around the original vertex's outward axis. Three points
    // need no sorting, but a d8 corner has four and a d20 corner has five.
    const axis = solid.vertices[original].clone().normalize();
    const origin = vertices[ring[0]];
    const e1 = origin
      .clone()
      .sub(axis.clone().multiplyScalar(origin.dot(axis)))
      .normalize();
    const e2 = new THREE.Vector3().crossVectors(axis, e1).normalize();

    const ordered = [...ring].sort((p, q) => {
      const vp = vertices[p];
      const vq = vertices[q];
      return (
        Math.atan2(vp.dot(e2), vp.dot(e1)) - Math.atan2(vq.dot(e2), vq.dot(e1))
      );
    });

    faces.push({ indices: ordered, marked: false });
  }

  // Edge and corner faces are assembled from adjacency, which says nothing
  // about which way round they wind. Left unfixed, roughly half of them are
  // clockwise seen from outside, get backface-culled, and the die renders with
  // its edges missing. The solid is convex and origin-centred, so the centroid
  // direction is a reliable "outward" reference.
  for (const face of faces) {
    const centroid = new THREE.Vector3();
    for (const i of face.indices) centroid.add(vertices[i]);
    centroid.divideScalar(face.indices.length);

    if (polygonNormal(vertices, face.indices).dot(centroid) < 0) {
      face.indices.reverse();
    }
  }

  return { vertices, faces };
}

export interface DieGeometry {
  geometry: THREE.BufferGeometry;
  /** Outward unit normal per *marked* face, in the die's local space. */
  faceNormals: THREE.Vector3[];
  /**
   * Which way is "up" for the mark on each face, in the die's local space.
   *
   * This is the same axis the UV mapping uses for the vertical direction, so
   * aligning it with the screen's up is what makes a face's artwork present the
   * right way round rather than at an arbitrary roll.
   */
  faceUps: THREE.Vector3[];
  /** Value printed on the marked face at the same index. */
  faceValues: number[];
  /** Flat point list for the physics convex hull. */
  hull: Float32Array;
}

/**
 * Builds the render geometry. Each polygonal face is fanned from its own
 * centroid — a corner fan would work too, but a centroid fan puts a vertex at
 * the middle of every face, which is exactly where the numeral needs to be
 * anchored for the UV mapping below.
 */
function buildGeometry(type: DieType): DieGeometry {
  const sides = DIE_SIDES[type];
  const beveled = chamfer(rawSolid(type), DIE_BEVELS[type]);

  // Normalise so every die shares a circumradius, then scale to world size.
  const maxLen = Math.max(...beveled.vertices.map((v) => v.length()));
  const scale = DIE_RADIUS / maxLen;
  const verts = beveled.vertices.map((v) => v.clone().multiplyScalar(scale));

  const normalOf = (indices: number[]) => {
    const n = polygonNormal(verts, indices);
    const centroid = new THREE.Vector3();
    for (const i of indices) centroid.add(verts[i]);
    centroid.divideScalar(indices.length);
    // Chamfer faces are built without regard to winding, so orientation is
    // resolved here against the outward direction rather than assumed.
    return n.dot(centroid) < 0 ? n.negate() : n;
  };

  const allNormals = beveled.faces.map((face) => normalOf(face.indices));

  // Only marked faces carry a value, and only they participate in reading the
  // landed result — a die never comes to rest on a bevel.
  const markedIndices = beveled.faces
    .map((face, i) => (face.marked ? i : -1))
    .filter((i) => i >= 0);
  const faceNormals = markedIndices.map((i) => allNormals[i]);
  // e2 from the UV basis below: the mark's vertical axis on that face.
  const faceUps = faceNormals.map((n) =>
    new THREE.Vector3().crossVectors(n, uprightBasis(n)).normalize(),
  );
  const faceValues = assignValues(faceNormals, sides);

  const valueOfFace = new Map<number, number>();
  markedIndices.forEach((faceIndex, k) => {
    valueOfFace.set(faceIndex, faceValues[k]);
  });

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  const { cols, rows, blankCell } = atlasGrid(sides);

  beveled.faces.forEach((face, faceIndex) => {
    const indices = face.indices;
    const normal = allNormals[faceIndex];
    const centroid = new THREE.Vector3();
    for (const i of indices) centroid.add(verts[i]);
    centroid.divideScalar(indices.length);

    // In-plane basis for projecting the polygon into its atlas cell.
    //
    // This has to be derived from the face's *orientation*, not from its vertex
    // list. Using the first vertex — the obvious choice — ties the mark's
    // rotation to however the face happened to be wound, so every face ends up
    // at a different arbitrary angle. Numerals tolerate that; a piece of
    // artwork looks broken.
    //
    // Projecting the die's local up onto the face plane gives every face a
    // consistent "up". A face that is itself horizontal has no such projection,
    // so those fall back to local +Z.
    const e1 = uprightBasis(normal);
    const e2 = new THREE.Vector3().crossVectors(normal, e1).normalize();

    // Half-extent of the face along its own axes, not its circumradius.
    //
    // The distinction matters: a square face's corners sit √2 further out than
    // its edges, so normalising by the corner distance leaves the edges mapped
    // well inside the cell and the face only ever samples the middle ~51% of
    // it. A numeral is small enough not to notice; artwork drawn to fill the
    // cell gets its extremities cropped off.
    //
    // The larger of the two axes is used for both, so a non-square face maps
    // its artwork uniformly rather than stretching it to a bounding box.
    let extent = EPS;
    for (const i of indices) {
      const d = new THREE.Vector3().subVectors(verts[i], centroid);
      extent = Math.max(extent, Math.abs(d.dot(e1)), Math.abs(d.dot(e2)));
    }

    // Bevel and corner faces sample the blank cell, picking up body colour
    // with no mark on it.
    const value = valueOfFace.get(faceIndex);
    const cell = value === undefined ? blankCell : value - 1;
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    const cw = 1 / cols;
    const ch = 1 / rows;
    // CanvasTexture flips Y, so row 0 (top of the canvas) is the top v-range.
    const u0 = col * cw;
    const v0 = 1 - (row + 1) * ch;

    // A marked face now maps onto nearly the whole cell — the small guard band
    // keeps texture filtering at the edges from sampling the neighbouring
    // cell. How much of the face the artwork covers is decided when the mark
    // is drawn, not here. Blank faces collapse to the middle of their cell.
    const fill = value === undefined ? 0.05 : 0.92;
    const uvOf = (p: THREE.Vector3) => {
      const d = new THREE.Vector3().subVectors(p, centroid);
      const x = d.dot(e1) / extent;
      const y = d.dot(e2) / extent;
      return [
        u0 + (x * 0.5 * fill + 0.5) * cw,
        v0 + (y * 0.5 * fill + 0.5) * ch,
      ];
    };

    for (let k = 0; k < indices.length; k++) {
      const a = centroid;
      const b = verts[indices[k]];
      const c = verts[indices[(k + 1) % indices.length]];

      for (const p of [a, b, c]) {
        positions.push(p.x, p.y, p.z);
        // Flat-shade: every vertex of a face carries the face normal, which is
        // what makes the die read as a cut solid rather than a blob.
        normals.push(normal.x, normal.y, normal.z);
        const [u, v] = uvOf(p);
        uvs.push(u, v);
      }
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();

  const hull = new Float32Array(verts.length * 3);
  verts.forEach((v, i) => {
    hull[i * 3] = v.x;
    hull[i * 3 + 1] = v.y;
    hull[i * 3 + 2] = v.z;
  });

  return { geometry, faceNormals, faceUps, faceValues, hull };
}

const cache = new Map<DieType, DieGeometry>();

export function getDieGeometry(type: DieType): DieGeometry {
  let entry = cache.get(type);
  if (!entry) {
    entry = buildGeometry(type);
    cache.set(type, entry);
  }
  return entry;
}

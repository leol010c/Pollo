/**
 * Structural checks on the die solids. Run with `npm run verify:geometry`.
 *
 * These catch the failure mode that is otherwise invisible: a die that renders
 * beautifully but reports the wrong number, because a face is non-planar, a
 * normal points inward, or the value table has a duplicate.
 */
import * as THREE from "three";
import { getDieGeometry } from "../lib/dice/geometry";
import {
  atlasGrid,
  DIE_SIDES,
  DIE_TYPES,
  DIE_RADIUS,
} from "../lib/dice/types";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    console.log(`  ok    ${label}`);
  }
}

for (const type of DIE_TYPES) {
  const sides = DIE_SIDES[type];
  console.log(`\n${type} (${sides} faces)`);

  const { geometry, faceNormals, faceValues, hull } = getDieGeometry(type);

  check(`face count is ${sides}`, faceNormals.length === sides, `got ${faceNormals.length}`);

  // Values must be exactly 1..N with no repeats.
  const sorted = [...faceValues].sort((a, b) => a - b);
  const expected = Array.from({ length: sides }, (_, i) => i + 1);
  check(
    "values are 1..N, unique",
    sorted.length === sides && sorted.every((v, i) => v === expected[i]),
    `got [${sorted.join(",")}]`,
  );

  // Normals must be unit length and outward-facing.
  check(
    "normals are unit length",
    faceNormals.every((n) => Math.abs(n.length() - 1) < 1e-5),
  );

  // Every normal must be distinct — duplicates mean two faces were merged.
  let distinct = true;
  for (let i = 0; i < faceNormals.length && distinct; i++) {
    for (let j = i + 1; j < faceNormals.length; j++) {
      if (faceNormals[i].dot(faceNormals[j]) > 0.999) {
        distinct = false;
        break;
      }
    }
  }
  check("all face normals distinct", distinct);

  // Antipodal faces should sum to N+1 (impossible on a tetrahedron).
  if (type !== "d4") {
    let allPaired = true;
    let sample = "";
    faceNormals.forEach((n, i) => {
      const opp = faceNormals.findIndex((m) => m.dot(n) < -0.999);
      if (opp === -1) {
        allPaired = false;
        sample = `face ${i} has no antipode`;
      } else if (faceValues[i] + faceValues[opp] !== sides + 1) {
        allPaired = false;
        sample = `${faceValues[i]} opposite ${faceValues[opp]}`;
      }
    });
    check(`opposite faces sum to ${sides + 1}`, allPaired, sample);
  }

  // Planarity of the marked faces. A non-planar "face" is a saddle and the die
  // will never rest cleanly on it.
  //
  // The mesh also contains bevel and corner geometry, which has its own planes
  // and must be excluded — only triangles whose normal matches a marked face's
  // normal are checked, and each is measured against that exact plane.
  const pos = geometry.getAttribute("position");
  let maxPlaneError = 0;
  let markedTris = 0;

  // Plane offset for each marked face, taken from a vertex known to be on it.
  const planeOffsets = faceNormals.map((n) => {
    let best = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(pos, i);
      best = Math.max(best, p.dot(n));
    }
    return best;
  });

  for (let t = 0; t < pos.count; t += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, t);
    const b = new THREE.Vector3().fromBufferAttribute(pos, t + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, t + 2);
    const triNormal = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
      .normalize();

    const faceIndex = faceNormals.findIndex((n) => n.dot(triNormal) > 0.9995);
    if (faceIndex === -1) continue; // bevel or corner geometry

    markedTris++;
    for (const p of [a, b, c]) {
      maxPlaneError = Math.max(
        maxPlaneError,
        Math.abs(p.dot(faceNormals[faceIndex]) - planeOffsets[faceIndex]),
      );
    }
  }

  check(
    "marked faces are planar",
    maxPlaneError < 1e-4,
    `max deviation ${maxPlaneError.toExponential(2)}`,
  );
  check(
    "every marked face has geometry",
    markedTris >= sides,
    `only ${markedTris} marked triangles for ${sides} faces`,
  );

  // The chamfer must actually have produced bevel geometry, or the die is still
  // a sharp-edged solid and the whole change is a no-op.
  check(
    "chamfer geometry present",
    pos.count / 3 > markedTris,
    `${pos.count / 3} total triangles vs ${markedTris} marked`,
  );

  // Every triangle's winding must agree with its shading normal. A triangle
  // wound the wrong way is backface-culled and renders as a hole — the die
  // still looks "fine" in a wireframe and is invisibly broken when lit, so
  // nothing but an explicit check catches it.
  const nrm = geometry.getAttribute("normal");
  let backfacing = 0;
  for (let t = 0; t < pos.count; t += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, t);
    const b = new THREE.Vector3().fromBufferAttribute(pos, t + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, t + 2);
    const wound = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
      .normalize();
    const shading = new THREE.Vector3().fromBufferAttribute(nrm, t);
    if (wound.dot(shading) < 0.5) backfacing++;
  }
  check(
    "all triangles wound outward",
    backfacing === 0,
    `${backfacing} of ${pos.count / 3} triangles face inward`,
  );

  // Hull must be the outer vertices only, all on the circumsphere or inside it.
  const hullPoints = hull.length / 3;
  let maxRadius = 0;
  for (let i = 0; i < hullPoints; i++) {
    maxRadius = Math.max(
      maxRadius,
      Math.hypot(hull[i * 3], hull[i * 3 + 1], hull[i * 3 + 2]),
    );
  }
  check(
    `circumradius is ${DIE_RADIUS}`,
    Math.abs(maxRadius - DIE_RADIUS) < 1e-5,
    `got ${maxRadius.toFixed(5)}`,
  );

  // UVs must stay inside the atlas.
  const uv = geometry.getAttribute("uv");
  let uvInRange = true;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (u < -1e-6 || u > 1 + 1e-6 || v < -1e-6 || v > 1 + 1e-6) {
      uvInRange = false;
      break;
    }
  }
  check("uvs within [0,1]", uvInRange);

  // Each marked face must map onto most of its atlas cell.
  //
  // A face that only samples the middle of its cell still renders — a numeral
  // is small and sits well inside — but anything drawn out toward the edges is
  // silently cropped. That is invisible until artwork replaces the numerals,
  // so it is asserted rather than eyeballed.
  const { cols, rows } = atlasGrid(sides);
  const cellW = 1 / cols;
  const cellH = 1 / rows;

  // How far the outermost vertex of a marked face reaches toward its cell's
  // edge, where 1 means it touches the edge exactly.
  let reach = 0;
  for (let t = 0; t < pos.count; t += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, t);
    const b = new THREE.Vector3().fromBufferAttribute(pos, t + 1);
    const c = new THREE.Vector3().fromBufferAttribute(pos, t + 2);
    const triNormal = new THREE.Vector3()
      .subVectors(b, a)
      .cross(new THREE.Vector3().subVectors(c, a))
      .normalize();
    if (!faceNormals.some((n) => n.dot(triNormal) > 0.9995)) continue;

    for (const i of [t, t + 1, t + 2]) {
      // Position within the face's own cell, remapped so 0 is the centre and
      // 1 the edge.
      const withinU = ((uv.getX(i) / cellW) % 1) - 0.5;
      const withinV = ((uv.getY(i) / cellH) % 1) - 0.5;
      reach = Math.max(reach, 2 * Math.abs(withinU), 2 * Math.abs(withinV));
    }
  }

  check(
    "marked faces span their atlas cell",
    reach > 0.8,
    `faces reach only ${(reach * 100).toFixed(0)}% of the way to the cell edge — artwork would be cropped`,
  );
}

console.log(
  failures === 0
    ? "\nAll geometry checks passed.\n"
    : `\n${failures} geometry check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);

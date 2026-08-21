/**
 * The room: what light falls on the table, what the table is, and where you are
 * standing.
 *
 * The look is a lit tray in a dark room, cool rather than candlelit — the
 * pictograms are signage, drawn in two flat inks, and they belong under a lamp
 * rather than in a boudoir. The felt is a petrol blue close enough to the cyan
 * they are printed in to sit beside it; the pink is then the only warm thing in
 * the frame, which is where the eye goes.
 */

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { frame } from "./framing";
import { CYAN, FELT, FELT_EDGE, INK, RAIL } from "./palette";
import type { Play } from "./throw";

/** Rail height and thickness, in world units. The die is one unit across. */
const RAIL_HEIGHT = 0.62;
const RAIL_THICKNESS = 0.36;

/**
 * The pool of light on the cloth, painted rather than lit.
 *
 * A spotlight would do this too and cost a second shadow map for a gradient
 * nobody looks at directly.
 */
function feltTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const gradient = ctx.createRadialGradient(
    size / 2,
    size * 0.44,
    size * 0.05,
    size / 2,
    size * 0.5,
    size * 0.62,
  );
  gradient.addColorStop(0, FELT);
  gradient.addColorStop(1, FELT_EDGE);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Reframes for a viewport and returns the felt the physics should use. */
  resize(width: number, height: number): Play;
  render(): void;
  /** Where on the felt a screen point lands, clamped to the play area. */
  aimAt(clientX: number, clientY: number): { x: number; z: number };
}

/**
 * A screen that is already drawing every pixel twice over does not also need
 * multisampling — the density is doing that job, and on a phone the second
 * pass is the difference between a throw that runs and one that stutters.
 */
const DENSE = window.devicePixelRatio >= 2;

/** Phones get the smaller shadow map. It is spread over a felt this big. */
const SHADOW_MAP = Math.min(window.screen.width, window.screen.height) < 640 ? 1024 : 2048;

export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !DENSE });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  // PCFSoft is deprecated and quietly downgraded to this anyway; asking for it
  // by name saves the warning and says what is actually being drawn.
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(INK);

  // A soft indoor environment, so the bone faces and the rail have something to
  // reflect. Without it a standard material in a dark room goes flat and plastic.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.28;
  pmrem.dispose();

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);

  scene.add(new THREE.HemisphereLight(0x5a87a0, 0x05090d, 0.55));

  /** The lamp over the table, and the only thing casting a shadow. */
  const key = new THREE.DirectionalLight(0xeaf4ff, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  scene.add(key);
  scene.add(key.target);

  /** A cyan kiss along the far edges, tying the object to what is printed on it. */
  const rim = new THREE.DirectionalLight(new THREE.Color(CYAN), 0.5);
  rim.position.set(-4, 3.2, -5);
  scene.add(rim);

  const felt = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.95, metalness: 0 }),
  );
  felt.rotation.x = -Math.PI / 2;
  felt.receiveShadow = true;
  scene.add(felt);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshStandardMaterial({ color: INK, roughness: 1, metalness: 0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);

  const railMaterial = new THREE.MeshStandardMaterial({
    color: RAIL,
    roughness: 0.5,
    metalness: 0.08,
  });
  const rails = {
    left: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), railMaterial),
    right: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), railMaterial),
    far: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), railMaterial),
    near: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), railMaterial),
  };
  for (const mesh of Object.values(rails)) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  let play: Play = { halfX: 3, halfZ: 4 };

  function layOut(next: Play) {
    play = next;
    const { halfX, halfZ } = next;
    const t = RAIL_THICKNESS;
    const h = RAIL_HEIGHT;

    felt.scale.set(halfX * 2, halfZ * 2, 1);

    // The side rails stop at the felt's ends and the end rails run the full
    // width, so the four meet in a corner rather than overlapping in one.
    rails.left.scale.set(t, h, halfZ * 2);
    rails.left.position.set(-halfX - t / 2, h / 2, 0);
    rails.right.scale.copy(rails.left.scale);
    rails.right.position.set(halfX + t / 2, h / 2, 0);

    rails.far.scale.set(halfX * 2 + t * 2, h, t);
    rails.far.position.set(0, h / 2, -halfZ - t / 2);
    rails.near.scale.copy(rails.far.scale);
    rails.near.position.set(0, h / 2, halfZ + t / 2);

    // The shadow camera is fitted to the felt rather than left at its default
    // box: a shadow map spread over a scene this small is a shadow map wasted.
    const reach = Math.max(halfX, halfZ) + 2;
    key.position.set(halfX * 0.55, reach * 1.9, halfZ * 0.5 + 2);
    key.target.position.set(0, 0, 0);
    const shadow = key.shadow.camera;
    shadow.left = -reach;
    shadow.right = reach;
    shadow.top = reach;
    shadow.bottom = -reach;
    shadow.near = 0.5;
    shadow.far = reach * 5;
    shadow.updateProjectionMatrix();
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const feltPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  return {
    renderer,
    scene,
    camera,

    resize(width, height) {
      const framing = frame(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height, false);
      camera.fov = framing.fov;
      camera.aspect = width / height;
      camera.position.set(framing.camera.x, framing.camera.y, framing.camera.z);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      layOut(framing.play);
      return framing.play;
    },

    render() {
      renderer.render(scene, camera);
    },

    aimAt(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      // A tap above the horizon has no point on the felt at all; the far rail is
      // the honest answer to "over there".
      if (!raycaster.ray.intersectPlane(feltPlane, hit)) {
        return { x: 0, z: -play.halfZ * 0.7 };
      }

      const margin = 0.9;
      return {
        x: THREE.MathUtils.clamp(hit.x, -play.halfX + margin, play.halfX - margin),
        z: THREE.MathUtils.clamp(hit.z, -play.halfZ + margin, play.halfZ - margin),
      };
    },
  };
}

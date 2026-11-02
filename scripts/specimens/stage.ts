/**
 * Browser-side studio for rendering specimen plates. Bundled by render.cjs and run in
 * headless Chromium. Exposes window.ISEE_STAGE.render(), which returns a supersampled
 * photographic render (PNG) and a same-camera ID pass (raw RGBA, no anti-aliasing).
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildSpecimen, type SpecimenId } from '../../src/web/three/specimens';

export interface ViewSpec {
  specimen: SpecimenId;
  /** Camera position and look-at target in metres. */
  camera: [number, number, number];
  target: [number, number, number];
  fov: number;
  /** Rotation of the specimen about Y, radians. */
  yaw: number;
  /** Key light direction (from), unnormalised. */
  key: [number, number, number];
  exposure: number;
  /** Soft contact shadows under the object: [size x, size z, opacity, falloff power]. */
  blobs: Array<[number, number, number, number]>;
  /** Floor fog distances (near, far) in metres from the camera. */
  fog: [number, number];
  envIntensity: number;
  /** Rotation of the studio environment about Y, radians. */
  envRotation: number;
}

const W = 1200;
const H = 900;
const SS = 2;
const BACKDROP = new THREE.Color('#ECE8DC');

function blobTexture(power: number): THREE.DataTexture {
  const n = 128;
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = Math.max(0, 1 - r);
      const v = Math.round(255 * Math.pow(a, power));
      const i = (y * n + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = v;
    }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  return btoa(s);
}

async function render(v: ViewSpec) {
  const canvas = document.createElement('canvas');
  canvas.width = W * SS;
  canvas.height = H * SS;
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W * SS, H * SS, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = v.exposure;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  scene.background = BACKDROP.clone();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = v.envIntensity;
  scene.environmentRotation.set(0, v.envRotation, 0);

  const camera = new THREE.PerspectiveCamera(v.fov, W / H, 0.01, 4);
  camera.position.set(...v.camera);
  camera.lookAt(new THREE.Vector3(...v.target));
  scene.fog = new THREE.Fog(BACKDROP.clone(), v.fog[0], v.fog[1]);

  // Floor: matte linen sweep that fogs into the backdrop.
  const floorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#EEE9DC'), roughness: 0.96, metalness: 0, envMapIntensity: 0.45 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Soft contact darkening under the object (the gradient's alpha drives opacity).
  const blobs: THREE.Mesh[] = [];
  v.blobs.forEach(([sx, sz, opacity, power], i) => {
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x000000, map: blobTexture(power), transparent: true, opacity, depthWrite: false, fog: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.scale.set(sx, sz, 1);
    blob.rotation.z = v.yaw;
    blob.position.y = 0.0001 * (i + 1);
    blob.renderOrder = i;
    scene.add(blob);
    blobs.push(blob);
  });

  const hemi = new THREE.HemisphereLight(0xfff8ee, 0xd9d2c0, 0.5);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff4e6, 2.2);
  key.position.set(...v.key);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 14;
  key.shadow.blurSamples = 24;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.0006;
  const sc = key.shadow.camera as THREE.OrthographicCamera;
  sc.left = -0.25;
  sc.right = 0.25;
  sc.top = 0.25;
  sc.bottom = -0.25;
  sc.near = 0.01;
  sc.far = 3;
  scene.add(key);
  scene.add(key.target);
  const rim = new THREE.DirectionalLight(0xe8f0ff, 0.55);
  rim.position.set(-v.key[0] * 0.8, v.key[1] * 0.6, -Math.abs(v.key[2]) - 0.5);
  scene.add(rim);

  const specimen = buildSpecimen(v.specimen);
  specimen.rotation.y = v.yaw;
  scene.add(specimen);

  renderer.render(scene, camera);
  const photo = canvas.toDataURL('image/png').split(',')[1]!;

  // ID pass: flat colours, no fog, no lights, no backdrop, no anti-aliasing.
  const parts: Array<{ index: number; part: string; label: string }> = [];
  const idOf = new Map<string, number>();
  specimen.children.forEach((c) => {
    if (!c.userData.part) return;
    const i = parts.length + 1;
    idOf.set(c.userData.part, i);
    parts.push({ index: i, part: c.userData.part, label: c.userData.label });
  });
  const saved = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  specimen.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    saved.set(m, m.material);
    const i = idOf.get(m.userData.part) ?? 0;
    const col = new THREE.Color();
    col.setRGB((i * 20) / 255, 128 / 255, 64 / 255, THREE.LinearSRGBColorSpace);
    m.material = new THREE.MeshBasicMaterial({ color: col, toneMapped: false, fog: false, side: THREE.DoubleSide });
  });
  floor.visible = false;
  blobs.forEach((b) => (b.visible = false));
  scene.background = new THREE.Color(0, 0, 0);
  scene.fog = null;
  scene.environment = null;
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 0, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace, depthBuffer: true });
  rt.texture.minFilter = THREE.NearestFilter;
  rt.texture.magFilter = THREE.NearestFilter;
  const prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  renderer.render(scene, camera);
  const buf = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  renderer.setRenderTarget(null);
  renderer.toneMapping = prevTone;
  saved.forEach((mat, m) => (m.material = mat));

  renderer.dispose();
  pmrem.dispose();
  canvas.remove();
  return { photo, ids: toBase64(buf), width: W, height: H, ss: SS, parts };
}

(window as unknown as { ISEE_STAGE: unknown }).ISEE_STAGE = { render };

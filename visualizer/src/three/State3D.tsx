import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** One district to raise: its map outline, color and how tall (0 = a dead heat, 1 = a landslide). */
export interface Block {
  id: string;
  d: string;
  color: string;
  height: number;
}

interface Props {
  blocks: Block[];
  selectedId: string | null;
  /** Hovered block and the pointer's viewport position, or null. */
  onHover: (hit: { id: string; x: number; y: number } | null) => void;
  onSelect: (id: string) => void;
}

const SPAN = 10; // the state's longer side, in scene units
const MIN_H = 0.12;
const MAX_H = 1.35;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;

type Ring = [number, number][];

/** An SVG path of M/L/Z commands (what build-geo.mjs writes) as closed rings. */
function ringsOf(d: string): Ring[] {
  return d
    .split("M")
    .filter((s) => s.trim())
    .map((s) =>
      s
        .replace(/Z/g, "")
        .split("L")
        .map((p) => p.split(",").map(Number) as [number, number]),
    )
    .filter((r) => r.length >= 3);
}

const signedArea = (r: Ring) => r.reduce((s, [x0, y0], i) => {
  const [x1, y1] = r[(i + 1) % r.length];
  return s + x0 * y1 - x1 * y0;
}, 0) / 2;

function inside([x, y]: [number, number], ring: Ring): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Outer rings wind one way and holes the other; each hole joins the outer ring around it. */
function shapesOf(rings: Ring[], toScene: (p: [number, number]) => THREE.Vector2): THREE.Shape[] {
  const largest = rings.reduce((a, b) => (Math.abs(signedArea(b)) > Math.abs(signedArea(a)) ? b : a));
  const outerSign = Math.sign(signedArea(largest));
  const outers = rings.filter((r) => Math.sign(signedArea(r)) === outerSign);
  const shapes = outers.map((r) => new THREE.Shape(r.map(toScene)));
  for (const hole of rings.filter((r) => Math.sign(signedArea(r)) !== outerSign)) {
    const i = outers.findIndex((o) => inside(hole[0], o));
    if (i >= 0) shapes[i].holes.push(new THREE.Path(hole.map(toScene)));
  }
  return shapes;
}

export function State3D({ blocks, selectedId, onHover, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<(id: string | null) => void>(() => {});
  const handlers = useRef({ onHover, onSelect });
  handlers.current = { onHover, onSelect };

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !blocks.length) return;
    const still = reducedMotion();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);

    // Fit the state into SPAN units, centred on the origin (map y points down, scene y up).
    const all = blocks.flatMap((b) => ringsOf(b.d).flat());
    const xs = all.map((p) => p[0]);
    const ys = all.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = SPAN / Math.max(x1 - x0, y1 - y0);
    const toScene = ([x, y]: [number, number]) => new THREE.Vector2((x - (x0 + x1) / 2) * k, -(y - (y0 + y1) / 2) * k);
    const radius = (Math.hypot(x1 - x0, y1 - y0) * k) / 2;

    // Extrusions grow along +z; turning the group makes that "up".
    const group = new THREE.Group();
    group.rotation.x = -Math.PI / 2;
    scene.add(group);

    interface Piece {
      id: string;
      mesh: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshStandardMaterial>;
      edges: THREE.LineSegments;
      color: THREE.Color;
      delay: number;
      lift: number;
    }
    const pieces: Piece[] = blocks.map((b, i) => {
      const depth = MIN_H + (MAX_H - MIN_H) * Math.min(1, Math.max(0, b.height));
      const geometry = new THREE.ExtrudeGeometry(shapesOf(ringsOf(b.d), toScene), {
        depth,
        bevelEnabled: true,
        bevelThickness: 0.025,
        bevelSize: 0.018,
        bevelSegments: 2,
        curveSegments: 1,
      });
      const color = new THREE.Color(b.color);
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.48, metalness: 0.04 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.id = b.id;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 35),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 }),
      );
      mesh.add(edges);
      group.add(mesh);
      if (!still) mesh.scale.z = 0.001;
      return { id: b.id, mesh, edges, color, delay: Math.min(i * 28, 650), lift: 0 };
    });

    // Light from the upper left, like a printed relief map; a ground plane catches the shadows.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8170, 1.35));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(-radius * 0.9, radius * 1.6, radius * 0.9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -radius * 1.4;
    sc.right = sc.top = radius * 1.4;
    sc.near = 0.1;
    sc.far = radius * 6;
    sun.shadow.bias = -0.0004;
    sun.shadow.radius = 6;
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(radius * 8, radius * 8), new THREE.ShadowMaterial({ opacity: 0.22 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.001;
    ground.receiveShadow = true;
    scene.add(ground);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minPolarAngle = 0.12;
    controls.maxPolarAngle = 1.28;
    controls.autoRotateSpeed = 0.45;
    controls.target.set(0, MAX_H * 0.25, 0);

    // The camera swoops from straight overhead to a three-quarter view, far enough back that the
    // whole state fits the frame.
    const dist = (radius * 0.95) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tilt = THREE.MathUtils.degToRad(48);
    const end = new THREE.Vector3(0, dist * Math.cos(tilt), dist * Math.sin(tilt));
    const start = new THREE.Vector3(0, dist * 1.25, 0.001);
    controls.minDistance = dist * 0.45;
    controls.maxDistance = dist * 1.8;
    camera.position.copy(still ? end : start);
    controls.update();
    let touched = false;
    controls.addEventListener("start", () => {
      touched = true;
      controls.autoRotate = false;
    });

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      // Narrow screens: back the camera off so the whole state stays in frame.
      camera.zoom = Math.min(1, (w / h) * 1.05);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    // Hover and selection both lift a block and make it glow.
    let hovered: string | null = null;
    let selected: string | null = null;
    selectRef.current = (id) => {
      selected = id;
    };
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hitAt = (e: PointerEvent): string | null => {
      const box = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - box.left) / box.width) * 2 - 1, -((e.clientY - box.top) / box.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(pieces.map((p) => p.mesh), false)[0];
      return (hit?.object.userData.id as string | undefined) ?? null;
    };
    let down: { x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => {
      if (e.buttons) return;
      hovered = hitAt(e);
      renderer.domElement.style.cursor = hovered ? "pointer" : "grab";
      handlers.current.onHover(hovered ? { id: hovered, x: e.clientX, y: e.clientY } : null);
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) {
        const id = hitAt(e);
        if (id) handlers.current.onSelect(id);
      }
      down = null;
    };
    const onLeave = () => {
      hovered = null;
      handlers.current.onHover(null);
    };
    const canvas = renderer.domElement;
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);

    const t0 = performance.now();
    const INTRO = 1500;
    renderer.setAnimationLoop((now) => {
      const t = now - t0;
      if (!still && t < INTRO + 200) {
        camera.position.lerpVectors(start, end, easeOutCubic(Math.min(1, t / INTRO)));
        if (t >= INTRO && !touched) controls.autoRotate = true;
      }
      for (const p of pieces) {
        if (!still) p.mesh.scale.z = Math.max(0.001, easeOutBack(Math.min(1, Math.max(0, (t - 250 - p.delay) / 700))));
        const target = p.id === selected ? 0.22 : p.id === hovered ? 0.12 : 0;
        p.lift += (target - p.lift) * 0.18;
        p.mesh.position.z = p.lift;
        const glow = p.id === selected ? 0.32 : p.id === hovered ? 0.2 : 0;
        p.mesh.material.emissive.copy(p.color).multiplyScalar(glow);
        (p.edges.material as THREE.LineBasicMaterial).opacity = p.id === selected ? 0.9 : 0.28;
      }
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      controls.dispose();
      for (const p of pieces) {
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        p.edges.geometry.dispose();
        (p.edges.material as THREE.Material).dispose();
      }
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [blocks]);

  useEffect(() => {
    selectRef.current(selectedId);
  }, [selectedId, blocks]);

  return <div ref={hostRef} className="state3d" />;
}

// Progressive reveal of a GLB: chunky voxels (coarse -> fine) -> grey clay sweep -> full colour sweep.
// `getProgress()` returns 0..1 and is read every frame, so the host clock drives the reveal.
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, OrbitControls, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type RevealStage = 'voxels' | 'clay' | 'color' | 'done';

// Timeline (fractions of reveal progress)
const VOXEL_END = 0.4;
const CLAY_START = 0.36;
const CLAY_END = 0.6;
const COLOR_START = 0.68;
const COLOR_END = 0.92;
const LEVELS = [4, 6, 8, 11, 15, 20, 27];
const SIZE = 2.2;

export function stageAt(p: number): RevealStage {
  if (p < CLAY_START) return 'voxels';
  if (p < COLOR_START) return 'clay';
  if (p < COLOR_END) return 'color';
  return 'done';
}

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const seg = (p: number, a: number, b: number) => ease((p - a) / (b - a));

function Env() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = tex;
    return () => {
      tex.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

interface Built {
  color: THREE.Object3D;
  clay: THREE.Object3D;
  levels: Float32Array[]; // per level: xyz centres
  cell: number[];
  minY: number;
  maxY: number;
  radius: number;
  colorPlane: THREE.Plane;
  clayTop: THREE.Plane;
  clayBottom: THREE.Plane;
  colorMats: THREE.Material[];
}

function build(scene: THREE.Object3D): Built {
  const root = skeletonClone(scene);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const s = SIZE / Math.max(size.x, size.y, size.z, 1e-6);
  const holder = new THREE.Group();
  root.position.sub(centre);
  holder.add(root);
  holder.scale.setScalar(s);
  holder.updateMatrixWorld(true);

  const colorPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), -10); // keep y <= h
  const clayTop = new THREE.Plane(new THREE.Vector3(0, -1, 0), -10); // keep y <= h
  const clayBottom = new THREE.Plane(new THREE.Vector3(0, 1, 0), 10); // keep y >= h

  // ---- sample surface points for voxels (world space, after normalisation)
  const pts: number[] = [];
  const meshes: THREE.Mesh[] = [];
  holder.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  const per = Math.max(400, Math.floor(9000 / Math.max(1, meshes.length)));
  const v = new THREE.Vector3();
  for (const m of meshes) {
    try {
      const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      const tmp = new THREE.Mesh(geo);
      const sampler = new MeshSurfaceSampler(tmp).build();
      for (let i = 0; i < per; i++) {
        sampler.sample(v);
        v.applyMatrix4(m.matrixWorld);
        pts.push(v.x, v.y, v.z);
      }
    } catch {
      /* skip weird geometry */
    }
  }
  const half = SIZE / 2;
  const levels: Float32Array[] = [];
  const cell: number[] = [];
  for (const n of LEVELS) {
    const c = SIZE / n;
    const seen = new Set<string>();
    const out: number[] = [];
    for (let i = 0; i < pts.length; i += 3) {
      const ix = Math.floor((pts[i] + half) / c);
      const iy = Math.floor((pts[i + 1] + half) / c);
      const iz = Math.floor((pts[i + 2] + half) / c);
      const k = `${ix},${iy},${iz}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push((ix + 0.5) * c - half, (iy + 0.5) * c - half, (iz + 0.5) * c - half);
    }
    levels.push(new Float32Array(out));
    cell.push(c);
  }

  // ---- colour copy (original materials, clipped from the top)
  const colorMats: THREE.Material[] = [];
  holder.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.frustumCulled = false;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mat) => {
      const c = mat.clone();
      c.clippingPlanes = [colorPlane];
      c.side = THREE.DoubleSide;
      colorMats.push(c);
      return c;
    });
    m.material = Array.isArray(m.material) ? mats : mats[0];
  });

  // ---- clay copy
  const clayHolder = new THREE.Group();
  const clayRoot = skeletonClone(root);
  clayHolder.add(clayRoot);
  clayHolder.scale.setScalar(s);
  const clayMat = new THREE.MeshStandardMaterial({
    color: '#cfc9d9',
    roughness: 0.85,
    metalness: 0,
    clippingPlanes: [clayTop, clayBottom],
    side: THREE.DoubleSide,
  });
  clayRoot.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.frustumCulled = false;
    m.material = Array.isArray(m.material) ? m.material.map(() => clayMat) : clayMat;
  });

  return { color: holder, clay: clayHolder, levels, cell, minY: -half, maxY: half, radius: half, colorPlane, clayTop, clayBottom, colorMats };
}

function Model({ url, getProgress, spin }: { url: string; getProgress: () => number; spin: boolean }) {
  const gltf = useGLTF(url);
  const built = useMemo(() => build(gltf.scene), [gltf.scene]);
  const group = useRef<THREE.Group>(null!);
  const voxels = useRef<THREE.InstancedMesh>(null!);
  const ring = useRef<THREE.Mesh>(null!);
  const level = useRef(-1);
  const voxelClip = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 10), []);
  const pop = useRef(1);
  const maxCount = Math.max(1, ...built.levels.map((l) => l.length / 3));

  // Real bounding Y of the model, for the sweeps
  const [y0, y1, ringR] = useMemo(() => {
    const b = new THREE.Box3().setFromObject(built.color);
    const r = Math.max(0.25, Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * 0.6);
    return [b.min.y - 0.02, b.max.y + 0.02, r];
  }, [built]);

  const colors = useMemo(() => {
    // height gradient: pink -> yellow -> cyan
    const c = new Float32Array(maxCount * 3);
    return c;
  }, [maxCount]);

  useEffect(
    () => () => {
      // Free GPU/CPU memory between rounds (a TV may run many games in a row).
      built.colorMats.forEach((m) => m.dispose());
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry?.dispose();
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((mat: any) => {
          Object.values(mat).forEach((v: any) => v?.isTexture && v.dispose());
          mat.dispose();
        });
      });
      useGLTF.clear(url);
    },
    [built, gltf, url],
  );

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const ca = useMemo(() => new THREE.Color('#FF4D6D'), []);
  const cb = useMemo(() => new THREE.Color('#FFBE0B'), []);
  const cc = useMemo(() => new THREE.Color('#00D1FF'), []);
  const tmpC = useMemo(() => new THREE.Color(), []);

  const setLevel = (li: number) => {
    const arr = built.levels[li];
    const n = arr.length / 3;
    const size = built.cell[li] * 0.9;
    for (let i = 0; i < n; i++) {
      dummy.position.set(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]);
      dummy.scale.setScalar(size);
      dummy.updateMatrix();
      voxels.current.setMatrixAt(i, dummy.matrix);
      const t = (arr[i * 3 + 1] - built.minY) / (built.maxY - built.minY);
      if (t < 0.5) tmpC.copy(ca).lerp(cb, t * 2);
      else tmpC.copy(cb).lerp(cc, (t - 0.5) * 2);
      voxels.current.setColorAt(i, tmpC);
    }
    voxels.current.count = n;
    voxels.current.instanceMatrix.needsUpdate = true;
    if (voxels.current.instanceColor) voxels.current.instanceColor.needsUpdate = true;
    pop.current = 0;
  };

  useFrame((_, dt) => {
    const p = Math.max(0, Math.min(1, getProgress()));
    if (spin) group.current.rotation.y += dt * 0.45;

    // voxels
    const li = Math.min(LEVELS.length - 1, Math.floor((p / VOXEL_END) * LEVELS.length));
    if (li !== level.current && voxels.current) {
      level.current = li;
      setLevel(li);
    }
    pop.current = Math.min(1, pop.current + dt * 4);
    const bounce = 1 + (pop.current < 1 ? 0.08 * Math.sin(pop.current * Math.PI) : 0);
    voxels.current.scale.setScalar(bounce);

    // clay sweeps up, then colour sweeps up over the clay
    const hClay = y0 + (y1 - y0) * seg(p, CLAY_START, CLAY_END);
    const hColor = y0 + (y1 - y0) * seg(p, COLOR_START, COLOR_END);
    // clay eats the voxels from the bottom up
    voxelClip.constant = p > CLAY_START ? -hClay : 10;
    voxels.current.visible = p < CLAY_END;
    built.clayTop.constant = hClay;
    built.clayBottom.constant = -hColor;
    built.colorPlane.constant = hColor;
    built.clay.visible = p > CLAY_START && p < COLOR_END + 0.01;
    built.color.visible = p > COLOR_START;

    // glowing scan ring at the active sweep
    const sweeping = (p > CLAY_START && p < CLAY_END) || (p > COLOR_START && p < COLOR_END);
    ring.current.visible = sweeping;
    ring.current.position.y = p < COLOR_START ? hClay : hColor;
    (ring.current.material as THREE.MeshBasicMaterial).color.set(p < COLOR_START ? '#00D1FF' : '#FFBE0B');
  });

  return (
    <group ref={group}>
      <instancedMesh ref={voxels} args={[undefined, undefined, maxCount]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.45} metalness={0.05} clippingPlanes={[voxelClip]} />
        <instancedBufferAttribute attach="instanceColor" args={[colors, 3]} />
      </instancedMesh>
      <primitive object={built.clay} />
      <primitive object={built.color} />
      <mesh ref={ring} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[ringR * 0.94, ringR, 64]} />
        <meshBasicMaterial transparent opacity={0.85} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** `?lowfx` (used by the headless screenshot script and slow TVs): ~5 fps, no contact shadows. */
export const LOWFX = typeof location !== 'undefined' && new URLSearchParams(location.search).has('lowfx');

export function Ticker({ fps = 5 }: { fps?: number }) {
  const { invalidate } = useThree();
  useEffect(() => {
    const id = setInterval(() => invalidate(), 1000 / fps);
    return () => clearInterval(id);
  }, [invalidate, fps]);
  return null;
}

function Loading() {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((_, dt) => {
    ref.current.rotation.x += dt;
    ref.current.rotation.y += dt * 1.3;
  });
  return (
    <mesh ref={ref}>
      <boxGeometry args={[0.6, 0.6, 0.6]} />
      <meshStandardMaterial color="#FFBE0B" wireframe />
    </mesh>
  );
}

export default function MeshReveal({
  url,
  getProgress,
  spin = true,
  orbit = false,
  className,
}: {
  url: string;
  getProgress: () => number;
  spin?: boolean;
  orbit?: boolean;
  className?: string;
}) {
  return (
    <div className={className ?? 'reveal-canvas'}>
      <Canvas
        dpr={LOWFX ? 1 : [1, 2]}
        frameloop={LOWFX ? 'demand' : 'always'}
        camera={{ position: [0, 0.9, 4.4], fov: 38 }}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
        }}
      >
        <Env />
        <hemisphereLight args={['#ffffff', '#3b2a6b', 0.7]} />
        {LOWFX && <Ticker />}
        <directionalLight position={[3, 5, 4]} intensity={1.6} />
        <directionalLight position={[-4, 2, -3]} intensity={0.6} color="#9fd8ff" />
        <Suspense fallback={<Loading />}>
          <Model key={url} url={url} getProgress={getProgress} spin={spin} />
        </Suspense>
        {!LOWFX && <ContactShadows position={[0, -1.15, 0]} opacity={0.45} scale={6} blur={2.4} far={3} resolution={256} />}
        {orbit && <OrbitControls enablePan={false} minDistance={2.5} maxDistance={8} />}
      </Canvas>
    </div>
  );
}

// "Lux3D is sculpting..." waiting screen: wobbly clay blob + orbiting voxels + progress.
import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { MeshDistortMaterial } from '@react-three/drei';
import * as THREE from 'three';
import type { PublicJob } from '../../../server/src/shared';
import { STYLE_META } from '../lib/fx';

const QUIPS = [
  'Teaching polygons to sit still…',
  'Negotiating with the vertices…',
  'Sanding the rough edges…',
  'Adding a suspicious amount of detail…',
  'Baking textures at 350°F…',
  'Untangling the normals…',
  'Asking the clay what it wants to be…',
  'Rounding the corners (ethically)…',
  'Counting faces. So many faces…',
];

function Blob() {
  const g = useRef<THREE.Group>(null!);
  useFrame((st, dt) => {
    g.current.rotation.y += dt * 0.6;
    g.current.children.forEach((c, i) => {
      if (i === 0) return;
      const t = st.clock.elapsedTime * 0.8 + i * 1.3;
      c.position.set(Math.cos(t) * 1.7, Math.sin(t * 1.7) * 0.6, Math.sin(t) * 1.7);
      c.rotation.x += dt * 2;
      c.rotation.z += dt * 1.4;
    });
  });
  const cols = ['#FF4D6D', '#FFBE0B', '#00D1FF', '#06D6A0', '#B388FF', '#FB5607'];
  return (
    <group ref={g}>
      <mesh>
        <icosahedronGeometry args={[1, 24]} />
        <MeshDistortMaterial color="#d8cfe6" roughness={0.75} distort={0.45} speed={2.2} />
      </mesh>
      {cols.map((c) => (
        <mesh key={c}>
          <boxGeometry args={[0.28, 0.28, 0.28]} />
          <meshStandardMaterial color={c} />
        </mesh>
      ))}
    </group>
  );
}

export default function Sculpting({ job, prompterName, now }: { job: PublicJob | null; prompterName?: string; now: () => number }) {
  const [quip, setQuip] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setQuip((q) => (q + 1) % QUIPS.length), 3200);
    return () => clearInterval(id);
  }, []);
  const started = job?.startedAt ?? job?.createdAt ?? now();
  const elapsed = Math.max(0, now() - started);
  const expected = job?.expectedMs ?? 60000;
  // asymptotic progress: never hits 100% until the model is actually there
  const pct = job?.status === 'queued' ? 3 : Math.min(97, 100 * (1 - Math.exp(-elapsed / (expected * 0.6))));
  const stageText =
    job?.status === 'queued'
      ? job.queuePosition
        ? `Waiting in the Lux3D queue (#${job.queuePosition})`
        : 'Queued'
      : job?.stage === 'downloading'
        ? 'Downloading the mesh'
        : job?.stage === 'submitted'
          ? 'Sent to Lux3D text-to-3D'
          : 'Lux3D is sculpting';
  const meta = job ? STYLE_META[job.style] : null;
  return (
    <div className="sculpting">
      <div className="sculpt-canvas">
        <Canvas camera={{ position: [0, 0.4, 4.6], fov: 40 }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[3, 4, 3]} intensity={1.6} />
          <directionalLight position={[-3, -1, -2]} intensity={0.6} color="#00D1FF" />
          <Blob />
        </Canvas>
      </div>
      <div className="sculpt-copy">
        <div className="kicker">{stageText}</div>
        <h2>
          Sculpting <span className="hl">{prompterName ?? 'a'}</span>
          {prompterName ? "'s" : ''} secret prompt
        </h2>
        {meta && (
          <div className="chip big">
            {meta.emoji} {meta.label} style
          </div>
        )}
        <div className="progress">
          <div className="bar" style={{ width: `${pct}%` }} />
        </div>
        <div className="meta-row">
          <span>{Math.round(elapsed / 1000)}s</span>
          <span className="quip">{QUIPS[quip]}</span>
          <span>{job?.provider === 'mock' ? 'mock mode' : `~${Math.round(expected / 1000)}s typical`}</span>
        </div>
      </div>
    </div>
  );
}

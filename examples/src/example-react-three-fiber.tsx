import { Sandbox } from '@pmndrs/sandbox/react';
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';

const index = `import { createRoot } from 'react-dom/client';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
`;

const app = `import { useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';

const COLORS = ['#ff8a65', '#ff4081', '#40c4ff', '#69f0ae', '#ffd740'];

function Box() {
  const ref = useRef();
  const [hovered, setHovered] = useState(false);
  const [index, setIndex] = useState(0);
  useFrame((_, delta) => {
    ref.current.rotation.x += delta;
    ref.current.rotation.y += delta * 0.6;
  });
  return (
    <mesh
      ref={ref}
      scale={hovered ? 1.3 : 1}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
      onClick={() => setIndex((i) => (i + 1) % COLORS.length)}
    >
      <boxGeometry args={[1.5, 1.5, 1.5]} />
      <meshStandardMaterial color={COLORS[index]} />
    </mesh>
  );
}

export default function App() {
  return (
    <Canvas camera={{ position: [3, 3, 3], fov: 50 }}>
      <color attach="background" args={['#0e0f12']} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={1.2} />
      <Box />
    </Canvas>
  );
}
`;

createRoot(document.getElementById('root') as HTMLElement).render(
    <Sandbox
        files={{ '/index.jsx': index, '/App.jsx': app }}
        dependencies={{ react: '^19', 'react-dom': '^19', '@react-three/fiber': '^9' }}
        theme="dark"
        showConsole
        style={{ '--sbx-height': 'calc(100vh - 32px)' } as CSSProperties}
    />,
);

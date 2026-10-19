import { Sandbox } from '@pmndrs/sandbox/react';
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';

const index = `import { createRoot } from 'react-dom/client';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<App />);
`;

const app = `import { useState } from 'react';
import confetti from 'canvas-confetti'; // not declared: served straight from esm.sh
import styles from './App.module.css';

export default function App() {
  const [n, setN] = useState(0);
  const click = () => {
    setN((x) => x + 1);
    confetti({ particleCount: 40, spread: 60, origin: { y: 0.2 } });
  };
  return (
    <button className={styles.button} onClick={click}>
      count: {n}
    </button>
  );
}
`;

const appCss = `.button {
  font: 600 22px system-ui;
  padding: 14px 22px;
  border-radius: 8px;
  cursor: pointer;
}
`;

const utils = `export const greeting = 'edit App.jsx — the count survives via Fast Refresh';
`;

createRoot(document.getElementById('root') as HTMLElement).render(
    <Sandbox
        files={{ '/index.jsx': index, '/App.jsx': app, '/App.module.css': appCss, '/utils.js': utils }}
        dependencies={{ react: '^19', 'react-dom': '^19' }}
        theme="dark"
        showConsole
        style={{ '--sbx-height': 'calc(100vh - 32px)' } as CSSProperties}
    />,
);

import { createDevServer, css, memoryFs, typescript } from '@pmndrs/sandbox';

// string-concatenated to avoid nested template literals.
const source = (label: string): string =>
    [
        "import './style.css';",
        "const root = document.getElementById('root') as HTMLElement;",
        "root.innerHTML = '';",
        'let n: number = 0;',
        "const btn = document.createElement('button');",
        "btn.style.cssText = 'font:600 22px system-ui;padding:14px 22px;cursor:pointer';",
        `function render() { btn.textContent = ${JSON.stringify(`${label}: `)} + n; }`,
        'btn.onclick = () => { n++; render(); };',
        'render();',
        'root.appendChild(btn);',
        'if (import.meta.hot) import.meta.hot.accept();',
    ].join('\n');

const host = document.getElementById('root') as HTMLElement;
host.innerHTML = `
<div style="display:flex;flex-direction:column;gap:12px;height:100%">
  <div style="display:flex;gap:12px;align-items:center">
    <button id="edit" style="font:600 13px system-ui;padding:8px 14px;border-radius:6px;cursor:pointer">Edit source</button>
    <button id="restyle" style="font:600 13px system-ui;padding:8px 14px;border-radius:6px;cursor:pointer">Edit css</button>
    <span style="color:#8a95a1;font:13px/1 system-ui">core API — createDevServer + plugins, no React layer</span>
  </div>
  <div style="display:flex;gap:12px;flex:1;min-height:0">
    <iframe id="preview" title="preview" style="flex:1;border:1px solid #2a2e35;border-radius:8px;background:#fff"></iframe>
    <pre id="log" style="flex:1;margin:0;overflow:auto;background:#0e0f12;color:#4ade80;padding:10px;border-radius:8px;border:1px solid #2a2e35;font:12px/1.4 ui-monospace"></pre>
  </div>
</div>`;

const log = document.getElementById('log') as HTMLPreElement;
const write = (line: string) => {
    log.textContent += `${line}\n`;
    log.scrollTop = log.scrollHeight;
};

const files = memoryFs({ '/main.ts': source('count'), '/style.css': 'button { background: #fde68a; }' });
const devServer = createDevServer({ fs: files, plugins: [css(), typescript()] });
const session = await devServer.open();

const mount = session.mount('/main.ts', { into: document.getElementById('preview') as HTMLIFrameElement });
mount.events.subscribe((m) => {
    if (m.type === 'ready') write('[ready] preview runtime up');
    else if (m.type === 'console') write(`[console.${m.level}] ${m.args.join(' ')}`);
    else if (m.type === 'runtime-error') write(`[error] ${m.message}`);
    else if (m.type === 'hmr') write(`[hmr] ${JSON.stringify(m.update)}`);
});

let edits = 0;
document.getElementById('edit')?.addEventListener('click', () => {
    edits += 1;
    files.write('/main.ts', source(`v${edits + 1}`));
});
const colors = ['#fde68a', '#a7f3d0', '#bfdbfe', '#fbcfe8'];
let color = 0;
document.getElementById('restyle')?.addEventListener('click', () => {
    color = (color + 1) % colors.length;
    files.write('/style.css', `button { background: ${colors[color]}; }`);
});

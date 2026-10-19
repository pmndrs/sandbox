# @pmndrs/sandbox

Embeddable, in-browser code sandboxes with HMR. oxc (wasm) transforms on the page; vite's module runner evaluates in an iframe; npm deps come from esm.sh.

```ts
import { createDevServer, memoryFs, css, json, assets, typescript, react, dependencies } from '@pmndrs/sandbox';

const fs = memoryFs({ '/main.tsx': `console.log('hi!')` });
const devServer = createDevServer({
    fs,
    plugins: [css(), json(), assets(), typescript(), react(), dependencies({ react: '^19', 'react-dom': '^19' })],
});

const session = await devServer.open();
const mount = session.mount('/main.tsx', { into: iframe });

fs.write('/main.tsx', `console.log('hot!')`); // hot-updates the iframe
```

React components (editor, preview, console):

```tsx
import { Sandbox } from '@pmndrs/sandbox/react';

<Sandbox files={{ '/App.jsx': app }} dependencies={{ three: '^0.170' }} />;
```

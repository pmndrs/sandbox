# @pmndrs/sandbox

Embeddable code sandboxes that run in the browser, with hot module reloading.

Code is transformed on the page with [oxc](https://oxc.rs) (compiled to wasm), then run in an iframe by Vite's module runner. npm packages are loaded from [esm.sh](https://esm.sh).

```ts
import { createDevServer, memoryFs, css, json, assets, typescript, react, dependencies } from '@pmndrs/sandbox';

const fs = memoryFs({ '/main.tsx': `console.log('hi!')` });

const devServer = createDevServer({
    fs,
    plugins: [css(), json(), assets(), typescript(), react(), dependencies({ react: '^19', 'react-dom': '^19' })],
});

const session = await devServer.open();
session.mount('/main.tsx', { into: iframe });

// updates the iframe without a reload
fs.write('/main.tsx', `console.log('hot!')`);
```

There are also React components for an editor, preview and console:

```tsx
import { Sandbox } from '@pmndrs/sandbox/react';

<Sandbox files={{ '/App.jsx': app }} dependencies={{ three: '^0.170' }} />;
```

---
title: Developer quickstart
slug: /get-started/developer-quickstart
sidebar_position: 2
---

# Developer quickstart

Create a spatial panel with a button, then run it in the desktop simulator.
You need Node.js 24 or later, npm, and a desktop browser.

## Create the project

```bash
npm create vite@latest my-xr-app -- --template vanilla-ts
cd my-xr-app
npm install xrblocks@0.24.0 three@0.186.0 lit
npm install --save-dev @types/three@0.186.0
```

Add the [Vite configuration](/get-started/installation#vite-configuration) for
XR Blocks. If you already have a project, start with
[installation](/get-started/installation#add-to-an-existing-project).

## Add a spatial panel

Replace `src/main.ts` with:

```ts title="src/main.ts"
import * as xb from 'xrblocks';

const message = new xb.UIText({text: 'Hello, XR!'});
const card = new xb.UICard({
  size: {width: 0.5, height: 'auto'},
  manipulation: true,
  edge: true,
  children: [
    message,
    new xb.UIButton({
      label: 'Click me',
      onClick: () => {
        message.text = 'It works!';
      },
    }),
  ],
});
card.position.set(0, 1.4, -1);

const options = new xb.Options();
options.xrButton.showEnterSimulatorButton = true;
xb.add(card);
await xb.init(options);
```

`UICard` places the UI in world space; its dimensions and position use meters.
The SDK handles rendering and input.

## Run it

```bash
npm run dev
```

Open the address printed by Vite. Enter the simulator if prompted, then press
**Click me**. The text changes to **It works!**. Drag the card's edge to move it.
Stop the server with Ctrl+C when finished.

Continue with [spatial UI](/sdk/ui), explore [examples](/examples), or
[run the app on an XR device](/get-started/run).

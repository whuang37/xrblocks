---
title: Agent quickstart
slug: /get-started/agent-quickstart
sidebar_position: 3
---

# Agent quickstart

Give your coding agent this request and a link to the
[developer quickstart](/get-started/developer-quickstart):

```text
Create an XR Blocks app with a spatial panel and a button that changes its text.
Follow the developer quickstart for setup and code. Build the project, then
provide the command to run it.
```

The agent should:

1. Create a normal Vite project and install the dependencies from
   [Create the project](/get-started/developer-quickstart#create-the-project).
2. Apply the [Vite configuration](/get-started/installation#vite-configuration)
   and put the [panel code](/get-started/developer-quickstart#add-a-spatial-panel)
   in `src/main.ts`.
3. Run `npm run build` and report the result. Use `npm run dev` to start the app.

In the simulator, **Click me** should change **Hello, XR!** to **It works!**.
Report which checks were run and stop task-owned servers before handoff.

For an existing project, read its installed SDK version first. Use the
[API reference](/api) for exact contracts and
[documentation access](/agents/documentation) for version matching.

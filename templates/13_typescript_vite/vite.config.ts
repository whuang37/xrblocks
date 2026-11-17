import {defineConfig} from 'vite';

// These optional integrations are not used by this starter. Keep the UI and
// simulator panel dependencies bundled so they resolve in the production app.
const unusedDependencies = [
  '@google/genai',
  '@mediapipe/tasks-vision',
  '@mediapipe/tasks-audio',
  'openai',
  '@sparkjsdev/spark',
  'three-mesh-bvh',
  '@litertjs/core',
  'three-pathfinding',
];

export default defineConfig({
  optimizeDeps: {
    exclude: unusedDependencies,
  },
  build: {
    rollupOptions: {
      external: unusedDependencies,
    },
  },
});

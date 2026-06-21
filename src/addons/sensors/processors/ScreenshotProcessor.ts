import * as THREE from 'three';

export async function renderAnnotatedScreenshot(
  camera: THREE.Camera,
  rawScreenshot: string,
  visibleObjects: Array<{object: THREE.Object3D; worldPosition: THREE.Vector3}>
): Promise<string> {
  if (!camera) return rawScreenshot;

  const img = new Image();
  img.src = rawScreenshot;
  await new Promise((resolve) => (img.onload = resolve));

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  let labelCounter = 1;

  for (const {worldPosition} of visibleObjects) {
    const screenPos = worldPosition.clone().project(camera);
    const x = ((screenPos.x + 1) * canvas.width) / 2;
    const y = ((-screenPos.y + 1) * canvas.height) / 2;

    ctx.beginPath();
    ctx.arc(x, y, 16, 0, 2 * Math.PI);
    ctx.fillStyle = '#ff0055';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelCounter.toString(), x, y);

    labelCounter++;
  }

  return canvas.toDataURL('image/png');
}

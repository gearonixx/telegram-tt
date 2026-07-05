type RgbTriple = [number, number, number];

// Assigning an invalid color to `fillStyle` is silently ignored, so two sentinels
// are needed to tell "parsed to this value" from "assignment did not stick"
const VALIDATION_SENTINELS = ['#000000', '#ffffff'];

let sharedContext: CanvasRenderingContext2D | undefined;

// Parses any CSS color the browser understands into 0-255 RGB channels without
// pulling the heavy `colorjs.io` dependency into the boot-critical bundle
export function parseCssColorToRgb(color: string): RgbTriple | undefined {
  if (!sharedContext) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    sharedContext = canvas.getContext('2d', { willReadFrequently: true })!;
  }

  const serializations = VALIDATION_SENTINELS.map((sentinel) => {
    sharedContext!.fillStyle = sentinel;
    sharedContext!.fillStyle = color;
    return sharedContext!.fillStyle;
  });
  if (serializations[0] !== serializations[1]) return undefined;

  sharedContext.clearRect(0, 0, 1, 1);
  sharedContext.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = sharedContext.getImageData(0, 0, 1, 1).data;
  if (a === 0) return undefined;

  return [r, g, b];
}

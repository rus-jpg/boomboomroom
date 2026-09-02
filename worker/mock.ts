import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const exec = promisify(execFile);

export function mockCharacterJpeg(name: string, prompt: string): Buffer {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768" viewBox="0 0 768 768">
  <defs>
    <radialGradient id="g" cx="40%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#ff4d7a"/>
      <stop offset="45%" stop-color="#3a0a2a"/>
      <stop offset="100%" stop-color="#07070b"/>
    </radialGradient>
  </defs>
  <rect width="768" height="768" fill="url(#g)"/>
  <circle cx="384" cy="300" r="110" fill="#1c0f18" stroke="#ffb020" stroke-width="6"/>
  <rect x="274" y="420" width="220" height="260" rx="110" fill="#1c0f18" stroke="#ff2d6a" stroke-width="4"/>
  <text x="384" y="720" text-anchor="middle" fill="#f6efe6" font-family="serif" font-size="36">${escapeXml(name)}</text>
  <text x="384" y="40" text-anchor="middle" fill="#ffb020" font-family="sans-serif" font-size="14">${escapeXml(prompt.slice(0, 48))}</text>
</svg>`;
  return Buffer.from(svg);
}

function escapeXml(s: string) {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
}

export async function ensureMockClip(index: number, outDir: string): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const dest = join(outDir, `mock-clip-${index}.mp4`);
  const hues = [320, 20, 200, 280, 40, 350];
  const hue = hues[index % hues.length];
  try {
    await exec("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x0b0610:s=1280x720:d=10:r=24,hue=h=${hue}:s=2`,
      "-vf",
      "format=yuv420p",
      "-an",
      dest,
    ]);
    return dest;
  } catch {
    writeFileSync(dest.replace(/\.mp4$/, ".txt"), `mock clip ${index}`);
    return dest;
  }
}

export function writeBuffer(path: string, buf: Buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
}

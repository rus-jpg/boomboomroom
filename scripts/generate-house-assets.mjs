#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "public/house");
mkdirSync(outDir, { recursive: true });

function writeWav(path, seconds = 60, sampleRate = 44100) {
  const n = seconds * sampleRate;
  const data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const beat = Math.floor(t * 2) % 2 === 0 ? 1 : 0.15;
    const kickEnv = Math.exp(-((t % 0.5) * 18));
    const kick = Math.sin(2 * Math.PI * (70 + kickEnv * 40) * t) * kickEnv * 0.55;
    const hat = (Math.random() * 2 - 1) * Math.exp(-((t % 0.25) * 40)) * 0.08;
    const bass = Math.sin(2 * Math.PI * 55 * t) * 0.18 * beat;
    const pad = Math.sin(2 * Math.PI * 110 * t) * 0.05 + Math.sin(2 * Math.PI * 164.8 * t) * 0.03;
    let s = kick + hat + bass + pad;
    s = Math.max(-1, Math.min(1, s));
    const v = Math.round(s * 32767);
    data.writeInt16LE(v, i * 4);
    data.writeInt16LE(v, i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

const wav = join(outDir, "house-audio.wav");
const mp3 = join(outDir, "house-audio.mp3");
if (!existsSync(mp3)) {
  console.log("writing house-audio.mp3");
  writeWav(wav, 60);
  try {
    execFileSync("ffmpeg", ["-y", "-i", wav, "-codec:a", "libmp3lame", "-q:a", "5", mp3], { stdio: "inherit" });
    try { unlinkSync(wav); } catch { /* keep wav if unlink fails */ }
  } catch {
    console.warn("mp3 encode failed; leaving wav");
  }
}

/** Moving gradient pairs — club lighting, not flat color fields. */
const palettes = [
  { c0: "0x1a0828", c1: "0x06141c", spot: "0x4a1838" },
  { c0: "0x241408", c1: "0x0a1820", spot: "0x503010" },
  { c0: "0x081828", c1: "0x041018", spot: "0x104050" },
  { c0: "0x180828", c1: "0x100818", spot: "0x381850" },
  { c0: "0x201008", c1: "0x08101a", spot: "0x482010" },
  { c0: "0x14081c", c1: "0x081420", spot: "0x183848" },
];

for (let i = 0; i < 6; i++) {
  const dest = join(outDir, `house-0${i + 1}.mp4`);
  const p = palettes[i];
  console.log("writing", dest);
  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-f", "lavfi",
        "-i", `gradients=s=1280x720:d=10:r=24:speed=0.11:type=linear:c0=${p.c0}:c1=${p.c1}:nb_colors=2`,
        "-f", "lavfi",
        "-i", `gradients=s=1280x720:d=10:r=24:speed=0.06:type=radial:c0=0x000000:c1=${p.spot}:nb_colors=2`,
        "-filter_complex",
        `[0][1]blend=all_mode=screen:all_opacity=0.62,hue=h=${12 + i * 4}*sin(2*PI*t/${7 + i}):s=1.18,vignette=angle=PI/4,noise=alls=6:allf=t,eq=contrast=1.14:brightness=-0.04:saturation=1.12,format=yuv420p`,
        "-an",
        "-t", "10",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "26",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        dest,
      ],
      { stdio: "inherit" },
    );
  } catch (err) {
    console.warn("ffmpeg clip failed", dest, err.message);
    writeFileSync(join(outDir, `house-0${i + 1}.txt`), `stub clip ${i + 1} — generate with npm run house:assets when ffmpeg is available\n`);
  }
}

writeFileSync(
  join(outDir, "README.md"),
  "# House buffers\n\n60s audio + six 10s 1280×720 procedural club clips used while a DJ set generates.\nRegenerate with `npm run house:assets`. Filenames stay the same if you swap in licensed masters.\n",
);

console.log("house assets ready in public/house");

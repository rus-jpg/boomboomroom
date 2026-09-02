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

const colors = ["0x3a0a22", "0x4a2208", "0x0a2438", "0x2a0a40", "0x3a2808", "0x400818"];
for (let i = 0; i < 6; i++) {
  const dest = join(outDir, `house-0${i + 1}.mp4`);
  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=${colors[i]}:s=1280x720:d=10:r=24`,
        "-vf",
        `geq=r='r(X,Y)+40*sin(T+X/180)':g='g(X,Y)':b='b(X,Y)+30*sin(T+Y/140)',format=yuv420p`,
        "-an",
        "-movflags",
        "+faststart",
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
  "# House buffers\n\nStub 60s audio + six 10s 1280×720 clips used while a DJ set generates.\nReplace with licensed house masters anytime; filenames stay the same.\n",
);

console.log("house assets ready in public/house");

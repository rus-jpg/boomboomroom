import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const ogSize = { width: 1200, height: 630 };
export const ogAlt = "Boom Boom Room — live AI music party";
export const ogContentType = "image/png";

async function loadFonts() {
  const fontsDir = join(process.cwd(), "lib/og/fonts");
  const [syne, outfit] = await Promise.all([
    readFile(join(fontsDir, "Syne-Bold.ttf")),
    readFile(join(fontsDir, "Outfit-Regular.ttf")),
  ]);
  return [
    { name: "Syne", data: syne, weight: 700 as const, style: "normal" as const },
    { name: "Outfit", data: outfit, weight: 400 as const, style: "normal" as const },
  ];
}

function ShareCardMarkup() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        backgroundColor: "#07070b",
        backgroundImage:
          "radial-gradient(ellipse 80% 70% at 50% 8%, rgba(255, 45, 106, 0.22), transparent 56%), radial-gradient(ellipse 52% 48% at 86% 92%, rgba(94, 231, 255, 0.14), transparent 52%), linear-gradient(180deg, #120810 0%, #07070b 62%)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 28,
          left: 28,
          right: 28,
          bottom: 28,
          border: "1px solid rgba(246, 239, 230, 0.12)",
          borderRadius: 28,
          display: "flex",
        }}
      />
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "72px 80px",
        }}
      >
        <div
          style={{
            display: "flex",
            fontFamily: "Outfit",
            fontSize: 15,
            fontWeight: 400,
            letterSpacing: "0.32em",
            color: "#ffb020",
            textTransform: "uppercase",
          }}
        >
          LIVE
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginTop: 18,
          }}
        >
          <div
            style={{
              display: "flex",
              fontFamily: "Syne",
              fontSize: 108,
              fontWeight: 700,
              letterSpacing: "-0.045em",
              lineHeight: 0.86,
              color: "#f6efe6",
            }}
          >
            BOOM BOOM
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Syne",
              fontSize: 108,
              fontWeight: 700,
              letterSpacing: "-0.045em",
              lineHeight: 0.86,
              color: "#f6efe6",
              marginTop: 4,
            }}
          >
            ROOM
          </div>
        </div>
        <div
          style={{
            width: 56,
            height: 3,
            marginTop: 28,
            backgroundColor: "#ff2d6a",
            borderRadius: 999,
            boxShadow: "0 0 28px rgba(255, 45, 106, 0.45)",
            display: "flex",
          }}
        />
        <div
          style={{
            display: "flex",
            marginTop: 26,
            fontFamily: "Outfit",
            fontSize: 30,
            fontWeight: 400,
            letterSpacing: "-0.01em",
            color: "#b7a89a",
          }}
        >
          live AI music party
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 16,
            fontFamily: "Outfit",
            fontSize: 16,
            fontWeight: 400,
            letterSpacing: "0.18em",
            color: "rgba(183, 168, 154, 0.82)",
            textTransform: "uppercase",
          }}
        >
          cast in · dance · take the booth
        </div>
      </div>
    </div>
  );
}

export async function shareCard() {
  return new ImageResponse(<ShareCardMarkup />, {
    ...ogSize,
    fonts: await loadFonts(),
  });
}

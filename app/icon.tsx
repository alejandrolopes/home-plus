import { ImageResponse } from "next/og";

// ImageResponse renderiza no edge/node em build/request; node simplifica.
export const runtime = "nodejs";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)",
          color: "#ffffff",
          fontWeight: 800,
          fontSize: 280,
          letterSpacing: -8,
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        H<span style={{ fontSize: 200, marginLeft: -10 }}>+</span>
      </div>
    ),
    { width: size.width, height: size.height },
  );
}

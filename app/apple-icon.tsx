import { ImageResponse } from "next/og";

export const runtime = "nodejs";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 96,
          letterSpacing: -3,
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        H<span style={{ fontSize: 70, marginLeft: -4 }}>+</span>
      </div>
    ),
    { width: size.width, height: size.height },
  );
}

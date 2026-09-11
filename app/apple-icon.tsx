import { ImageResponse } from "next/og";

/**
 * The same die as icon.svg, as a PNG, because iOS will not take an SVG.
 *
 * `apple-icon` accepts only .jpg/.jpeg/.png as a file, so the alternative to
 * generating it here is committing a binary that nothing can diff and that will
 * silently disagree with icon.svg the first time either is touched. This is
 * built once at build time and cached.
 *
 * Read icon.svg for why it looks like this — in short, it is the most public
 * surface the app has and it gives nothing away.
 *
 * No rounded corners on the outer square: iOS masks home-screen icons to its
 * own shape, and a radius baked in here would be clipped inside that mask,
 * leaving a dark seam around the edge.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Pip centres on the five face, as a fraction of the die's own width. */
const PIPS = [
  [0.25, 0.25],
  [0.75, 0.25],
  [0.5, 0.5],
  [0.25, 0.75],
  [0.75, 0.75],
] as const;

const DIE = 106;
const PIP = 18;

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
          background: "#1f1d20",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            width: DIE,
            height: DIE,
            borderRadius: 23,
            background: "#f2ece4",
          }}
        >
          {PIPS.map(([x, y]) => (
            <div
              key={`${x}-${y}`}
              style={{
                position: "absolute",
                left: x * DIE - PIP / 2,
                top: y * DIE - PIP / 2,
                width: PIP,
                height: PIP,
                borderRadius: PIP,
                background: "#26232a",
              }}
            />
          ))}
        </div>
      </div>
    ),
    size,
  );
}

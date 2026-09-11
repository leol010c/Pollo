import type { MetadataRoute } from "next";

/**
 * What the app is called when it is installed.
 *
 * Every string here is the cover story, and deliberately the same one
 * layout.tsx already tells — a dice simulator, described plainly enough that
 * the description is not itself suspicious. This is the version of it somebody
 * can read without opening anything, so it is the version that matters most.
 *
 * `standalone` earns its place beyond looking tidy. Installed, the app loses
 * Safari's address bar and toolbar entirely, which are the two strips the seam
 * gradients in DiceApp.tsx exist to blend into — so the room simply runs to the
 * edges of the screen. Those gradients stay for the browser-tab case, which is
 * still how it is usually opened.
 *
 * The colours match --bg, as layout.tsx's themeColor does, so the splash the OS
 * paints while the scene loads is the colour the scene clears to rather than a
 * white flash in a dark room.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dice Throw",
    short_name: "Dice",
    description:
      "A 3D physics dice simulator. Click a die to throw it and read whatever lands face up.",
    start_url: "/",
    display: "standalone",
    // Portrait only. The framing is solved per viewport shape and works in
    // landscape, but this is a phone held upright — locking it stops a stray
    // rotation reframing the table mid-throw.
    orientation: "portrait",
    background_color: "#150610",
    theme_color: "#150610",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}

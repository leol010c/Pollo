import type { NextConfig } from "next";

/**
 * The RFC 1918 private ranges, as host patterns Next will actually match.
 *
 * Next compares these a dot-segment at a time and `*` stands for exactly one
 * whole segment — there are no ranges and no character classes — so a block
 * that is not aligned to an octet boundary has to be spelled out.
 *
 * 172.16.0.0/12 is the one that bites. It spans 172.16 through 172.31, and it
 * was written here as the single pattern `172.16.*.*`, which matches only the
 * first sixteenth of it. iOS Personal Hotspot hands out 172.20.10.x — inside
 * the range, outside the pattern — so tethering the phone to the Mac, which is
 * exactly how this app gets tested away from a desk, was the one case the
 * allowance was written for and did not cover.
 *
 * The other two blocks are octet-aligned and need one pattern each.
 */
const PRIVATE_RANGES = [
  "10.*.*.*",
  "192.168.*.*",
  ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`),
] as const;

const nextConfig: NextConfig = {
  /*
   * Off, and this is the one setting here with a visible cost.
   *
   * The App Router turns Strict Mode on unless told otherwise, and in
   * development it deliberately runs every effect twice: mount, clean up, mount
   * again. That is a good way to find effects that do not tidy up after
   * themselves, and for almost every component in this app it is free.
   *
   * The Canvas is not almost every component. Mounting it acquires a WebGL
   * context; unmounting it hands the renderer back to react-three-fiber, which
   * tears it down in a `setTimeout(..., 500)` and calls `forceContextLoss()` at
   * the end of it — see `unmountComponentAtNode` in the package. The second
   * mount has already taken the same canvas by then, so half a second into every
   * page load that timer fires and kills the context the scene is *currently*
   * drawing into.
   *
   * What happens next is the app behaving correctly: `webglcontextlost` is a
   * real event, a lost context cannot be drawn to, and DiceApp does the only
   * thing it can — remounts the scene with a fresh one. A remounted scene builds
   * a new die and drops it. So every refresh showed the die falling, a pause,
   * and the die falling again.
   *
   * There is no way to exempt a subtree from Strict Mode, and the alternatives
   * are worse: recovering less eagerly would leave a genuinely dead scene on
   * screen, and neutering `forceContextLoss` would leak a context per remount
   * against a browser limit of about sixteen.
   *
   * **This changes nothing about production.** The double invocation is a
   * development-only behaviour; a built app never did it, which is why this only
   * ever showed up on the dev server.
   */
  reactStrictMode: false,

  // The dev overlay defaults to the bottom-left, directly on top of the deck
  // control. Development-only, but it makes that button unclickable while
  // working on the app.
  devIndicators: { position: "top-left" },

  // The phone is the product, so it has to be possible to load the dev server
  // from one. `next dev` already binds 0.0.0.0 and prints a Network URL, but
  // Next blocks cross-origin requests to dev-only assets by default — without
  // this, opening that URL on a phone breaks HMR and the dev overlay.
  //
  // Private ranges only, and development only. This has no effect on a build.
  allowedDevOrigins: [...PRIVATE_RANGES],
};

export default nextConfig;

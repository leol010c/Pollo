"use client";

/**
 * The same failure, one level further out.
 *
 * error.tsx renders *inside* the root layout, so it cannot catch a throw in the
 * layout itself. This one replaces the whole document, which is why it has to
 * ship its own <html> and <body> — there is no layout left above it to provide
 * them, and that is also why it cannot use the app's fonts or design tokens:
 * globals.css is imported by the layout that just failed.
 *
 * So it is written in inline styles against the same palette by hand. It should
 * essentially never be seen; the cost of it being plain is far lower than the
 * cost of it throwing while trying to render prettily.
 *
 * `<title>` rather than a metadata export: this is a Client Component, as every
 * error boundary must be, and metadata exports do not apply to one.
 */
export default function GlobalError({
  // See the note in error.tsx on why this rather than `reset`.
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "0 1.5rem",
          textAlign: "center",
          // --bg and --fg from globals.css, written out because the stylesheet
          // that defines them is not loaded here.
          background: "#150610",
          color: "#fbeff4",
          font: "500 14px/1.5 system-ui, sans-serif",
        }}
      >
        <title>Dice Throw</title>
        <div style={{ maxWidth: "20rem" }}>
          <p style={{ margin: 0 }}>Something went wrong</p>
          <p
            style={{
              margin: "0.375rem 0 0",
              fontSize: 12,
              fontWeight: 400,
              lineHeight: 1.6,
              color: "#d3b0c0",
            }}
          >
            The app hit an error it couldn&apos;t recover from on its own.
            Trying again usually clears it.
          </p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              marginTop: "1rem",
              height: "2.75rem",
              padding: "0 1rem",
              border: 0,
              borderRadius: 6,
              background: "#ec5f86",
              color: "#1a0610",
              font: "600 14px system-ui, sans-serif",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

// Static (GitHub Pages) mode flag. Set VITE_STATIC=1 at build time and the app
// runs with no backend: the api client, grading engine, and auth are all served
// from the browser (see ./install.ts). Unset — the normal `make dev` / `make
// build` path — every request goes to the FastAPI backend over /api, unchanged.

export function isStatic(): boolean {
  return import.meta.env.VITE_STATIC === '1';
}

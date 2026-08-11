/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '1' builds the backend-free static (GitHub Pages) client: the browser
   *  becomes its own backend — bundled demo data + a client-side grading engine
   *  that calls providers directly with a bring-your-own key. Unset for the
   *  normal build that talks to the FastAPI backend over /api. */
  readonly VITE_STATIC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

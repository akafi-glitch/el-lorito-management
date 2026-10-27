import { z } from "zod";

/**
 * Zod normally probes whether `new Function` works so it can compile faster checks. The app's
 * Content Security Policy forbids that (no eval in the browser), and the probe would show up as a
 * policy violation. Jitless mode skips the probe; the checks behave exactly the same.
 */
z.config({ jitless: true });

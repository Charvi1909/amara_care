// Vercel serverless entry point.
//
// Vercel treats every file under /api as a serverless function. This one just
// re-exports the Express app defined in ../server.mjs (which, when it detects
// process.env.VERCEL, skips app.listen and lets the platform drive it).
//
// vercel.json rewrites every incoming request to here, so the same app that
// runs locally with `npm start` also handles both the API routes and the
// static frontend in production.

import app from '../server.mjs';

export default app;

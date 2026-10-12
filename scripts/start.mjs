await import('./build.mjs');
process.env.OMD_STATIC_DIR='dist';
await import('./serve.mjs');

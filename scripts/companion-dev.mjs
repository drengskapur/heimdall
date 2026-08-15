// Dev launcher for the local companion: bakes in a fixed token and the dev-server
// origins so the browser app can reach it without CORS/token fiddling. Override any
// of these by exporting the env var yourself before running.
//
//   npm run companion:dev
//
// Then in the app: Preferences → Cluster proxy → token "heimdall-dev" → Test.
//
// NOTE: the companion reads HEIMDALL_COMPANION_*-prefixed env vars (see its env()).
process.env.HEIMDALL_COMPANION_TOKEN ||= "heimdall-dev";
process.env.HEIMDALL_COMPANION_ORIGINS ||= [
  "http://localhost:5199",
  "http://127.0.0.1:5199", // dev:ui
  "http://localhost:3000",
  "http://127.0.0.1:3000", // default SPA port
  "http://localhost:4173",
  "http://127.0.0.1:4173", // vite preview
].join(",");

await import("../companion/server.mjs");

// worker/api-names.ts imports the app's name planner, which pulls in src/lib/api.ts.
// That file names one browser-only type that the Workers runtime types lack. An empty
// interface declares it here and merges cleanly if a DOM lib is ever present.
interface PushSubscriptionJSON {}

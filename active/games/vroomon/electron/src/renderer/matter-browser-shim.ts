type MatterModule = typeof import("matter-js");

declare global {
  interface Window {
    Matter?: MatterModule;
  }
}

if (!window.Matter) {
  throw new Error("Matter.js global was not loaded before the browser shim.");
}

const matterModule = window.Matter;

export default matterModule;

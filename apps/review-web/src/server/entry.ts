// The server side of the review page, built apart from the page (vite build
// --ssr) and loaded by the collagen instance: Solid's server-function
// handler, every server function the page calls (the manifest registers
// them), and the hook the instance provides its backend through.
import "virtual:solid-server-function-manifest";
import "../api";
export { handleServerFunctionRequest } from "virtual:solid-server-function-handler";
export { provideBackend } from "./backend";

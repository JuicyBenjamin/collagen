import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { initToken } from "./auth/client";
import { App } from "./ui/App";

await initToken();
const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);

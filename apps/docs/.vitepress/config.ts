import { withMermaid } from "vitepress-plugin-mermaid";

// withMermaid wraps defineConfig and registers the client-side mermaid renderer
// so ```mermaid fenced blocks render as diagrams.
export default withMermaid({
  title: "Collagen",
  description: "Collaborative agents — a p2p middleman between two people's coding AIs.",
  cleanUrls: true,
  lastUpdated: true,

  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/overview" },
      { text: "Status", link: "/status" },
    ],
    sidebar: {
      "/": [
        {
          text: "Product",
          items: [
            { text: "What is Collagen?", link: "/guide/overview" },
            { text: "Rooms & presence", link: "/guide/rooms" },
            { text: "Conversations", link: "/guide/conversations" },
            { text: "Tickets", link: "/guide/tickets" },
            { text: "Identity & devices", link: "/guide/identity" },
            { text: "Using the CLI", link: "/guide/using-the-cli" },
          ],
        },
        {
          text: "Project",
          items: [{ text: "Status & roadmap", link: "/status" }],
        },
        {
          text: "Internals",
          collapsed: true,
          items: [
            { text: "Architecture", link: "/internals/architecture" },
            { text: "Message flow", link: "/internals/message-flow" },
            { text: "Effect patterns", link: "/internals/effect-patterns" },
            { text: "Local development", link: "/internals/development" },
          ],
        },
      ],
    },
    outline: { level: [2, 3] },
    search: { provider: "local" },
    socialLinks: [{ icon: "github", link: "https://github.com/" }],
  },

  // Theme follows the page (light/dark).
  mermaid: {},

  // Mermaid pulls in CJS deps (dayjs, etc.); pre-bundle them so their ESM
  // default imports resolve in dev — otherwise the client app fails to mount
  // ("does not provide an export named 'default'") and pages render blank.
  vite: {
    optimizeDeps: {
      include: ["mermaid", "dayjs"],
    },
    ssr: {
      noExternal: ["mermaid"],
    },
  },
});

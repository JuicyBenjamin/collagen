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
          text: "Guide",
          items: [
            { text: "Overview", link: "/guide/overview" },
            { text: "Architecture", link: "/guide/architecture" },
            { text: "Message flow", link: "/guide/message-flow" },
            { text: "Effect patterns", link: "/guide/effect-patterns" },
            { text: "Local development", link: "/guide/development" },
          ],
        },
        {
          text: "Project",
          items: [{ text: "Status & roadmap", link: "/status" }],
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

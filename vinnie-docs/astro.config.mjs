// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLinksValidator from "starlight-links-validator";

const REPO = "https://github.com/1anP33in/vinnie";

export default defineConfig({
  // Set this to the public URL when the site is deployed (used for the sitemap and canonical links).
  site: "https://vinnie-docs.example.invalid",
  integrations: [
    starlight({
      title: "Vinnie Docs",
      description: "Official documentation for Vinnie AI, the local AI developer agent for Windows.",
      logo: { src: "./src/assets/vinnie-mark.svg", alt: "Vinnie" },
      favicon: "/favicon.svg",
      social: [{ icon: "github", label: "Vinnie on GitHub", href: REPO }],
      editLink: { baseUrl: `${REPO}/edit/master/vinnie-docs/` },
      lastUpdated: false,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      customCss: ["./src/styles/vinnie.css"],
      components: {
        ThemeProvider: "./src/components/overrides/ThemeProvider.astro",
        PageTitle: "./src/components/overrides/PageTitle.astro",
        SiteTitle: "./src/components/overrides/SiteTitle.astro",
      },
      expressiveCode: {
        themes: ["github-dark-default", "github-light-default"],
        styleOverrides: { borderRadius: "0.5rem", codeFontFamily: "var(--sl-font-mono)" },
      },
      plugins: [starlightLinksValidator({ errorOnLocalLinks: true })],
      sidebar: [
        { label: "Getting Started", items: [{ autogenerate: { directory: "getting-started" } }] },
        { label: "User Guide", items: [{ autogenerate: { directory: "user-guide" } }] },
        { label: "Agent System", items: [{ autogenerate: { directory: "agent-system" } }] },
        { label: "Ollama and Models", items: [{ autogenerate: { directory: "ollama" } }] },
        { label: "MCP Integration", items: [{ autogenerate: { directory: "mcp" } }] },
        { label: "Skills", items: [{ autogenerate: { directory: "skills" } }] },
        { label: "Ice Dragon Companion", items: [{ autogenerate: { directory: "dragon" } }] },
        { label: "Developer Documentation", collapsed: true, items: [{ autogenerate: { directory: "developer" } }] },
        { label: "Security", collapsed: true, items: [{ autogenerate: { directory: "security" } }] },
        { label: "Troubleshooting", collapsed: true, items: [{ autogenerate: { directory: "troubleshooting" } }] },
        { label: "Additional", collapsed: true, items: [{ autogenerate: { directory: "additional" } }] },
      ],
    }),
  ],
});

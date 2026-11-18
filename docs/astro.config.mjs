import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightThemeGalaxy from "starlight-theme-galaxy";

export default defineConfig({
  site: "https://rennerdo30.github.io/any-i18n",
  base: "/any-i18n",
  integrations: [
    starlight({
      title: "any-i18n",
      logo: { src: "./src/assets/logo.svg" },
      favicon: "/favicon.svg",
      description:
        "Browser extension, translation server, and CLI that add multilanguage support to any website at runtime.",
      plugins: [starlightThemeGalaxy()],
      customCss: ["./src/styles/custom.css"],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/rennerdo30/any-i18n" },
      ],
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "index" },
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Configuration", slug: "getting-started/configuration" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Architecture", slug: "guides/architecture" },
            { label: "Browser Extension", slug: "guides/extension" },
            { label: "Translation Providers", slug: "guides/providers" },
            { label: "Translation Server", slug: "guides/server" },
            { label: "CLI", slug: "guides/cli" },
            { label: "File Formats", slug: "guides/file-formats" },
          ],
        },
      ],
    }),
  ],
});

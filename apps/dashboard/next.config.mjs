/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@switchboard/schemas", "@switchboard/db", "bcryptjs"],
  output: "standalone",

  experimental: {
    // Tree-shake these large packages at the module level so only the icons/
    // components actually used get bundled. Cuts JS payload significantly for
    // lucide-react (500+ icons) and the Radix UI family.
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-select",
      "@radix-ui/react-tabs",
      "@radix-ui/react-toast",
      "@radix-ui/react-switch",
      "@radix-ui/react-radio-group",
      "@radix-ui/react-checkbox",
    ],
  },
};

export default nextConfig;

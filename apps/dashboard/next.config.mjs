/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@switchboard/schemas", "@switchboard/db"],
  output: "standalone",
};

export default nextConfig;

import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile in the user profile directory otherwise makes Turbopack
  // mis-infer the workspace root.
  turbopack: { root: path.join(__dirname) },
};

export default nextConfig;

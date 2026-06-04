import { join } from "node:path";

import "@gwigz/sl-tools-env/web";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: true,
  turbopack: {
    root: join(import.meta.dirname, "..", ".."),
  },
};

export default nextConfig;

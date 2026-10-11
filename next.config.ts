import os from "node:os";
import type { NextConfig } from "next";

/**
 * Phones load the site from this computer's Wi-Fi address (e.g. 192.168.1.5).
 * Next.js blocks dev requests from addresses it doesn't know, so list them.
 */
function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry!.address);
}

const nextConfig: NextConfig = {
  allowedDevOrigins: lanAddresses(),
  devIndicators: false,
};

export default nextConfig;

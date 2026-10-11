import os from "node:os";

/**
 * Finds this computer's address on the local Wi-Fi, so phones know where to
 * connect. Prefers home-router style addresses (192.168.x.x) over the virtual
 * adapters Windows creates for WSL, Hyper-V or VPNs.
 */
export function getLanAddresses(): string[] {
  const found: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) found.push(entry.address);
    }
  }
  const rank = (ip: string) =>
    ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : ip.startsWith("172.") ? 2 : 3;
  return found.sort((a, b) => rank(a) - rank(b));
}

/**
 * api-proxy.config.js — BlackRoad / Lucidia Custom API Routing
 *
 * Routes all outbound AI-vendor API calls through @blackboxprogramming /
 * @lucidia infrastructure (Cloudflare Workers + Tailscale mesh).
 *
 * No traffic flows directly to OpenAI, Anthropic, GitHub Copilot, or any
 * other vendor — every request is intercepted and forwarded by the
 * BlackRoad proxy layer.
 *
 * Infrastructure path:
 *   Client  →  Cloudflare Worker (api-proxy.blackboxprogramming.workers.dev)
 *           →  Tailscale mesh (lucidia.earth private network)
 *           →  Vendor API
 *
 * Usage (fetch):
 *   import { proxyFetch } from './api-proxy.config.js';
 *   const res = await proxyFetch('openai', '/v1/chat/completions', { ... });
 *
 * Usage (override global fetch):
 *   import { installGlobalProxy } from './api-proxy.config.js';
 *   installGlobalProxy();   // call once at app start-up
 */

// ---------------------------------------------------------------------------
// Proxy base URL — set via Cloudflare secret or environment variable.
// ---------------------------------------------------------------------------
const API_PROXY_BASE =
  (typeof process !== 'undefined' && process.env?.BLACKROAD_API_PROXY_URL) ||
  'https://api-proxy.blackboxprogramming.workers.dev';

// ---------------------------------------------------------------------------
// Vendor routing table
// Entries map a friendly alias to the upstream base URL.
// The proxy rewrites the Host header and forwards the request.
// ---------------------------------------------------------------------------
export const VENDOR_ROUTES = {
  openai: {
    upstream: 'https://api.openai.com',
    proxyPath: '/openai',
  },
  anthropic: {
    upstream: 'https://api.anthropic.com',
    proxyPath: '/anthropic',
  },
  github: {
    upstream: 'https://api.github.com',
    proxyPath: '/github',
  },
  copilot: {
    upstream: 'https://copilot-proxy.githubusercontent.com',
    proxyPath: '/copilot',
  },
  google_ai: {
    upstream: 'https://generativelanguage.googleapis.com',
    proxyPath: '/google-ai',
  },
};

// ---------------------------------------------------------------------------
// Core helper — proxied fetch
// ---------------------------------------------------------------------------

/**
 * Make an API call through the BlackRoad proxy instead of directly to the vendor.
 *
 * @param {string} vendor           - Key from VENDOR_ROUTES
 * @param {string} path             - Upstream path, e.g. '/v1/chat/completions'
 * @param {RequestInit} [options]   - Standard fetch options (method, headers, body …)
 * @returns {Promise<Response>}
 */
export async function proxyFetch(vendor, path, options = {}) {
  const route = VENDOR_ROUTES[vendor];
  if (!route) throw new Error(`Unknown API vendor: "${vendor}"`);

  const url = `${API_PROXY_BASE}${route.proxyPath}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'X-BlackRoad-Vendor': vendor,
      'X-BlackRoad-Version': '1',
      ...(options.headers || {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Optional: intercept global fetch so existing code routes automatically
// ---------------------------------------------------------------------------

const _VENDOR_ORIGINS = Object.fromEntries(
  Object.entries(VENDOR_ROUTES).map(([k, v]) => [new URL(v.upstream).origin, k])
);

/**
 * Replace globalThis.fetch with a version that transparently rewrites requests
 * targeting known vendor origins through the BlackRoad proxy.
 *
 * Call once at application start-up (before any vendor API calls are made).
 */
export function installGlobalProxy() {
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = function blackroadProxyFetch(input, init = {}) {
    let url;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else {
      url = input.url;
    }

    try {
      const origin = new URL(url).origin;
      const vendor = _VENDOR_ORIGINS[origin];
      if (vendor) {
        const route = VENDOR_ROUTES[vendor];
        const rewritten = url.replace(route.upstream, `${API_PROXY_BASE}${route.proxyPath}`);
        const headers = {
          'X-BlackRoad-Vendor': vendor,
          'X-BlackRoad-Version': '1',
          ...(init.headers || {}),
        };
        console.debug(`[BlackRoad proxy] ${url} → ${rewritten}`);
        return originalFetch(rewritten, { ...init, headers });
      }
    } catch {
      // Non-URL input — pass through unchanged
    }

    return originalFetch(input, init);
  };
}

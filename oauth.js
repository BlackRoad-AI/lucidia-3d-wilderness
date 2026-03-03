/**
 * oauth.js — BlackRoad / Lucidia OAuth Proxy Configuration
 *
 * All OAuth flows route through the @blackboxprogramming / @lucidia
 * infrastructure instead of connecting directly to third-party vendors.
 *
 * Architecture:
 *   Client  →  BlackRoad proxy (Cloudflare Worker)  →  Vendor OAuth endpoint
 *
 * Usage:
 *   import { getOAuthUrl, exchangeCode, revokeToken } from './oauth.js';
 *
 * Required environment / Cloudflare secrets:
 *   BLACKROAD_PROXY_URL  — base URL of the Cloudflare Worker proxy
 *   OAUTH_CLIENT_ID      — OAuth client ID issued by the vendor
 *   OAUTH_CLIENT_SECRET  — OAuth client secret (never exposed client-side)
 */

// ---------------------------------------------------------------------------
// Proxy base — all requests flow through BlackRoad infrastructure.
// Set this via a Cloudflare secret or an environment variable.
// ---------------------------------------------------------------------------
const PROXY_BASE =
  (typeof process !== 'undefined' && process.env?.BLACKROAD_PROXY_URL) ||
  'https://oauth-proxy.blackboxprogramming.workers.dev';

// ---------------------------------------------------------------------------
// Supported vendor aliases
// ---------------------------------------------------------------------------
const VENDORS = {
  openai:    { path: '/openai'    },
  anthropic: { path: '/anthropic' },
  github:    { path: '/github'    },
  google:    { path: '/google'    },
};

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/**
 * Build the proxied OAuth authorization URL for the given vendor.
 *
 * @param {string} vendor      - One of the keys in VENDORS
 * @param {Object} params      - Query parameters (scope, redirect_uri, state …)
 * @returns {string}           - Full URL to redirect the user to
 */
export function getOAuthUrl(vendor, params = {}) {
  const entry = VENDORS[vendor];
  if (!entry) throw new Error(`Unknown OAuth vendor: "${vendor}"`);

  const url = new URL(`${PROXY_BASE}${entry.path}/authorize`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Exchange an authorization code for tokens via the BlackRoad proxy.
 *
 * @param {string} vendor       - One of the keys in VENDORS
 * @param {string} code         - The authorization code from the callback
 * @param {string} redirectUri  - Must match the redirect_uri used in getOAuthUrl
 * @returns {Promise<Object>}   - Token response from the vendor
 */
export async function exchangeCode(vendor, code, redirectUri) {
  const entry = VENDORS[vendor];
  if (!entry) throw new Error(`Unknown OAuth vendor: "${vendor}"`);

  const res = await fetch(`${PROXY_BASE}${entry.path}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Revoke a token via the BlackRoad proxy.
 *
 * @param {string} vendor  - One of the keys in VENDORS
 * @param {string} token   - Access or refresh token to revoke
 * @returns {Promise<void>}
 */
export async function revokeToken(vendor, token) {
  const entry = VENDORS[vendor];
  if (!entry) throw new Error(`Unknown OAuth vendor: "${vendor}"`);

  await fetch(`${PROXY_BASE}${entry.path}/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

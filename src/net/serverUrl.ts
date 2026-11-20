/**
 * Where the game server is. Not a player setting: it is fixed when the game is built or served.
 *  - VITE_SERVER_URL (build-time environment variable) wins when set, e.g. wss://neonvel.example/ws
 *  - the development servers (ports 5173 / 4173): the local game server on port 8787 of the same machine
 *  - otherwise (the game served by the real host): the same address under /ws, which the web server passes on
 *    to the game server (https pages connect with wss).
 */
export function serverUrl(): string {
  const env = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim();
  if (env) return env;
  const { protocol, hostname, host, port } = window.location;
  if (port === '5173' || port === '4173' || !hostname) return `ws://${hostname || 'localhost'}:8787/ws`;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/ws`;
}

/** The game server's HTTP address (store, sign-in, leaderboards): the WebSocket address without /ws. */
export function serverHttp(): string {
  return serverUrl().replace(/^ws(s?):\/\//, 'http$1://').replace(/\/ws\/?$/, '').replace(/\/$/, '');
}

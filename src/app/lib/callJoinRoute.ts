export interface CallJoinParams {
  sessionId: string;
  token: string;
}

/** App invite route — server builds the full link via APP_URL + /call/join?session=&token= */
export const CALL_JOIN_PATH = '/call/join';

export function isCallJoinRoute(pathname = window.location.pathname): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return normalized.endsWith(CALL_JOIN_PATH);
}

export function parseCallJoinParams(location: Pick<Location, 'pathname' | 'search'> = window.location): CallJoinParams | null {
  if (!isCallJoinRoute(location.pathname)) return null;

  const params = new URLSearchParams(location.search);
  const sessionId = String(params.get('session') || params.get('sessionId') || '').trim();
  const token = String(params.get('token') || '').trim();
  if (!sessionId || !token) return null;

  return { sessionId, token };
}

export function clearCallJoinUrl() {
  window.history.replaceState({}, '', '/');
}

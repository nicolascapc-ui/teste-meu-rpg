export interface RouteMatch {
  view: 'lobby' | 'table' | 'screen' | 'join' | 'play';
  param?: string;
}

export function parseRoutePath(rawPath: string): RouteMatch {
  const clean = rawPath.replace(/^#/, '').replace(/\/+$/, '') || '/';

  const tableMatch = clean.match(/(?:^|\/)table\/([a-zA-Z0-9_-]+)$/);
  if (tableMatch) return { view: 'table', param: tableMatch[1] };

  const screenMatch = clean.match(/(?:^|\/)screen\/([a-zA-Z0-9_-]+)$/);
  if (screenMatch) return { view: 'screen', param: screenMatch[1] };

  const joinMatch = clean.match(/(?:^|\/)join\/([a-zA-Z0-9]+)$/);
  if (joinMatch) return { view: 'join', param: joinMatch[1].toUpperCase() };

  const playMatch = clean.match(/(?:^|\/)play\/([a-zA-Z0-9_-]+)$/);
  if (playMatch) return { view: 'play', param: playMatch[1] };

  return { view: 'lobby' };
}

/**
 * Supports both Hash URLs (`#/screen/id`, required for GitHub Pages & pure static HTML)
 * and standard pathnames (`/screen/id`, for local dev or root hosting).
 */
export function parseCurrentRoute(): RouteMatch {
  const hash = window.location.hash;
  if (hash && hash.length > 1) {
    return parseRoutePath(hash);
  }
  return parseRoutePath(window.location.pathname);
}

/**
 * Builds an absolute shareable URL (for Second Screen TV and Mobile QR Code)
 * that works identically on root domains, GitHub Pages subpaths (/repo/), and static hosting.
 */
export function buildAppUrl(routePath: string): string {
  const normalized = routePath.startsWith('/') ? routePath : `/${routePath}`;
  const basePath = window.location.pathname.replace(/\/(table|screen|join|play)\/[^/]*$/, '/');
  const safePath = basePath.endsWith('/') || basePath.endsWith('.html') ? basePath : `${basePath}/`;
  return `${window.location.origin}${safePath}#${normalized}`;
}

export function navigateToRoute(routePath: string): RouteMatch {
  const normalized = routePath.startsWith('/') ? routePath : `/${routePath}`;
  if (normalized === '/') {
    if (window.location.hash) {
      window.location.hash = '/';
    } else if (/^\/(table|screen|join|play)\//.test(window.location.pathname)) {
      window.history.pushState({}, '', '/');
    }
    return { view: 'lobby' };
  }
  window.location.hash = normalized;
  return parseRoutePath(normalized);
}

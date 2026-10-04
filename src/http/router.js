// A tiny router. Path parameters accept only safe characters, so ids can be
// placed in database queries without surprises.

const PARAM = '([A-Za-z0-9_-]{1,64})';

export function createRouter(routes) {
  const compiled = routes.map((route) => {
    const names = [];
    const pattern = route.path.replace(/:([a-z_]+)/gi, (_, name) => { names.push(name); return PARAM; });
    return { ...route, regex: new RegExp('^' + pattern + '$'), names };
  });

  return {
    match(method, pathname) {
      let pathMatched = false;
      for (const route of compiled) {
        const m = route.regex.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (route.method !== method) continue;
        const params = {};
        route.names.forEach((n, i) => { params[n] = m[i + 1]; });
        return { route, params };
      }
      return pathMatched ? { methodNotAllowed: true } : null;
    }
  };
}

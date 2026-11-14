// In-app navigation. Games call go() instead of touching history directly, so
// the arcade router sees every change of game.

const ROUTE = "arcade:route";

export function go(path: string, replace = false): void {
  if (path !== location.pathname) history[replace ? "replaceState" : "pushState"](null, "", path);
  dispatchEvent(new Event(ROUTE));
}

export function onRoute(fn: () => void): void {
  addEventListener(ROUTE, fn);
  addEventListener("popstate", fn);
}

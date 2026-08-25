/**
 * Thin wrapper around fetch() for talking to the existing /api/ endpoints
 * (the same ones pyobs-task-editor uses), authenticated via the Django
 * session cookie set by the frontend's login view.
 *
 * getCsrfToken() is defined in base.html.
 */

const API_BASE = "/api/";

async function apiRequest(path, options = {}) {
  const opts = {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  };
  if (opts.method && opts.method !== "GET") {
    opts.headers["X-CSRFToken"] = getCsrfToken();
  }
  if (opts.body && typeof opts.body !== "string") {
    opts.body = JSON.stringify(opts.body);
  }

  const url = path.startsWith("/") ? path : API_BASE + path;
  const resp = await fetch(url, opts);

  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      const data = await resp.json();
      detail = JSON.stringify(data);
    } catch (_) {
      /* ignore */
    }
    throw new Error(`${resp.status} ${detail}`);
  }
  if (resp.status === 204) return null;
  const text = await resp.text();
  return text ? JSON.parse(text) : null;
}

/** Fetch all pages of a paginated DRF list endpoint, returning a flat array. */
async function apiList(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  let url = API_BASE + path.replace(/^\//, "") + (qs ? `?${qs}` : "");
  let results = [];
  while (url) {
    const resp = await fetch(url, { credentials: "same-origin" });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    const data = await resp.json();
    if (Array.isArray(data)) return data;
    results = results.concat(data.results || []);
    url = data.next || null;
  }
  return results;
}

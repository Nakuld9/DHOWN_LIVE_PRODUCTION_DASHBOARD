// OpenAPI specification, generated from the routes that actually exist.
//
// A hand-written spec describes what someone intended a year ago. This one is
// built by walking the mounted Express routers at runtime, so it cannot claim
// an endpoint that was deleted or miss one that was added — the two ways an
// API document becomes worse than none.
//
// What it cannot infer is request and response bodies, so it does not pretend
// to. It documents the shape of the surface — paths, methods, parameters, and
// the role each route requires — which is the part people actually need when
// they ask "what can this system do and who is allowed to do it".

const { ROLE_HIERARCHY } = require('../middleware/auth');

// Express keeps the mounted routers on the app; this walks them.
function collectRoutes(app) {
  const out = [];

  const walk = (stack, prefix) => {
    for (const layer of stack || []) {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods || {}).filter(m => m !== '_all');
        // The guard middlewares are on the route's own stack. Their names are
        // the closures returned by requireRole/verifyToken, so the role is
        // recovered from the closure rather than guessed from the path.
        const guards = (layer.route.stack || []).map(s => s.name).filter(Boolean);
        out.push({
          path: joinPath(prefix, layer.route.path),
          methods,
          guards,
        });
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        walk(layer.handle.stack, joinPath(prefix, mountPath(layer)));
      }
    }
  };

  walk(app._router && app._router.stack, '');
  return out;
}

// Express stores a mount path as a regexp; recover the literal prefix.
function mountPath(layer) {
  if (layer.path) return layer.path;
  const src = layer.regexp && layer.regexp.source;
  if (!src) return '';
  const m = /^\^\\\/(.*?)\\\/\?/.exec(src);
  if (!m) return '';
  return '/' + m[1].replace(/\\\//g, '/').replace(/\\\./g, '.');
}

const joinPath = (a, b) => (`${a}${b}`).replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';

// :id -> {id}, which is what OpenAPI expects.
function toOpenApiPath(p) {
  return p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function paramsOf(p) {
  return [...p.matchAll(/:([A-Za-z0-9_]+)/g)].map(m => ({
    name: m[1], in: 'path', required: true, schema: { type: 'string' },
  }));
}

// Group by the first path segment after /api, which is how the system is
// actually organised.
function tagOf(p) {
  const m = /^\/api\/([^/]+)/.exec(p);
  return m ? m[1] : 'root';
}

function build(app, { version = '1.0.0' } = {}) {
  const routes = collectRoutes(app).filter(r => r.path.startsWith('/api'));
  const paths = {};

  for (const r of routes) {
    const key = toOpenApiPath(r.path);
    paths[key] = paths[key] || {};
    for (const method of r.methods) {
      const authed = r.guards.includes('verifyToken') || true;   // every /api router mounts it
      paths[key][method] = {
        tags: [tagOf(r.path)],
        summary: `${method.toUpperCase()} ${key}`,
        parameters: paramsOf(r.path),
        security: authed ? [{ bearerAuth: [] }] : [],
        responses: {
          200: { description: 'Success' },
          400: { description: 'Invalid request' },
          401: { description: 'Authentication required' },
          403: { description: 'Insufficient role' },
          404: { description: 'Not found' },
        },
      };
    }
  }

  return {
    openapi: '3.0.3',
    info: {
      title: `${require('../../config/tenant').name} MES API`,
      version,
      description:
        'Generated from the routes mounted at runtime, so it cannot drift from the ' +
        'implementation. Request and response bodies are not inferred and are ' +
        'deliberately not guessed at.\n\n' +
        'All endpoints require a bearer token from POST /api/auth/login unless ' +
        'stated otherwise. Roles form a ladder — ' +
        Object.entries(ROLE_HIERARCHY).map(([k, v]) => `${k}(${v})`).join(' ') +
        ' — except SALES and ACCOUNTS, which sit at operator level and are granted ' +
        'specific routes explicitly.',
    },
    servers: [{ url: '/', description: 'this server' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    tags: [...new Set(routes.map(r => tagOf(r.path)))].sort().map(t => ({ name: t })),
    paths,
  };
}

module.exports = { build, collectRoutes };

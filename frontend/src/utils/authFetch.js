const _originalFetch = window.fetch.bind(window);

// Global fetch interceptor for MES API calls:
// - injects the JWT on every /api request
// - on 401 clears the session and redirects to /login (except on mobile /m/* pages,
//   which have their own inline login)
window.fetch = function (url, options = {}) {
  let urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : '';

  // Legacy absolute URLs: rewrite localhost:4000 → actual server hostname
  if (urlStr.includes('localhost:4000')) {
    urlStr = urlStr.replace('localhost', window.location.hostname);
    url = urlStr;
  }

  const isApi = urlStr.startsWith('/api') || urlStr.includes(':4000');
  if (isApi) {
    const token = localStorage.getItem('dhown_token');
    if (token) {
      options = {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${token}`,
        },
      };
    }
    return _originalFetch(url, options).then((res) => {
      if (res.status === 401 && !window.location.pathname.startsWith('/m/')) {
        localStorage.removeItem('dhown_token');
        localStorage.removeItem('dhown_current_user');
        window.location.href = '/login';
      }
      return res;
    });
  }

  return _originalFetch(url, options);
};

const _originalFetch = window.fetch.bind(window);

window.fetch = function (url, options = {}) {
  let urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : '';

  // Rewrite localhost:4000 → actual server hostname so network PCs work
  if (urlStr.includes('localhost:4000')) {
    urlStr = urlStr.replace('localhost', window.location.hostname);
    url = urlStr;
  }

  if (urlStr.includes(':4000')) {
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
      if (res.status === 401) {
        localStorage.removeItem('dhown_token');
        localStorage.removeItem('dhown_current_user');
        window.location.href = '/login';
      }
      return res;
    });
  }

  return _originalFetch(url, options);
};

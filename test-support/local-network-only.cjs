/* eslint-disable @typescript-eslint/no-require-imports -- Preloaded before the disposable Node server and all children. */
if (process.env.TEST_NETWORK_ISOLATION === 'local-only') {
  const net = require('node:net');
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    const options = typeof first === 'object' && first !== null ? first : null;
    const host = options?.host || (typeof args[1] === 'string' ? args[1] : 'localhost');
    const local = host === 'localhost' || host === '::1' || host === '[::1]' || /^127\./.test(host) || /^::ffff:127\./.test(host);
    if (!options?.path && typeof first !== 'string' && !local) {
      throw new Error(`Test network isolation refused non-local connection to ${host}`);
    }
    return connect.apply(this, args);
  };
}

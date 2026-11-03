const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

// Whether a URL's hostname names this machine. Browsers resolve every
// `.localhost` name to loopback themselves, so no other site can be pointed
// at one; that's what lets Docent run behind a local proxy such as portless.
export const isLocalHost = (hostname: string) => LOCAL_HOSTS.includes(hostname) || hostname.endsWith('.localhost');

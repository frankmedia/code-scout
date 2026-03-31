import "@testing-library/jest-dom";

// Polyfill crypto.randomUUID for jsdom (not available by default)
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.randomUUID) {
  const orig = globalThis.crypto ?? {};
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...orig,
      randomUUID: () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}

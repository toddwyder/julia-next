import { registerHooks } from 'node:module'

const fakes = {
  'adapter.mjs': new URL('./adapter.mjs', import.meta.url).href,
  'catalogue.mjs': new URL('./catalogue.mjs', import.meta.url).href,
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context)
    if (resolved.url.includes('/fake-runtime/')) return resolved
    for (const [name, url] of Object.entries(fakes)) {
      if (resolved.url.endsWith(`/ops/build-runner/${name}`)) return { url, shortCircuit: true }
    }
    return resolved
  },
})

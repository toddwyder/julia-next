export function observeRequests(transportFetch, requests) {
  return async (input, init) => {
    const request = new Request(input, init)
    let body
    try { body = await request.clone().json() } catch {}
    const entry = { model: body?.model, method: request.method, url: request.url }
    requests.push(entry)
    try {
      const response = await transportFetch(request)
      entry.status = response.status
      return response
    } catch (error) {
      entry.refusal = error.message
      throw error
    }
  }
}

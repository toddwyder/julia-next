import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import WebSocket from 'ws'
import { z } from 'zod/v4'
import { agentError } from './agent-errors.ts'

const MessageSchema = z.object({ id: z.union([z.number(), z.string()]).optional(), method: z.string().optional(), params: z.unknown().optional(), result: z.unknown().optional(), error: z.object({ code: z.number(), message: z.string() }).optional() })

/** Official Unix WebSocket endpoint of the shared daemon. */
export async function connectCodexProxy({ onNotification = async () => {}, onDisconnect = async () => {}, socketPath }: {
  onNotification?: (method: string, params: unknown) => Promise<void>; onDisconnect?: (error?: Error) => Promise<void>; socketPath?: string
} = {}) {
  if (!socketPath) {
    const { stdout } = await promisify(execFile)('codex', ['app-server', 'daemon', 'version'])
    socketPath = z.object({ socketPath: z.string().startsWith('/'), appServerVersion: z.literal('0.163.0') }).parse(JSON.parse(stdout)).socketPath
  }
  const socket = new WebSocket(`ws+unix:${socketPath}:/`, { handshakeTimeout: 10000 })
  await once(socket, 'open')
  let nextId = 0
  let closing = false
  let queue = Promise.resolve()
  let disconnected = false
  const disconnect = async (error?: Error) => {
    if (disconnected) return
    disconnected = true
    try { await onDisconnect(error) }
    catch (failure) { console.error(JSON.stringify(agentError(failure, { provider: 'codex', runId: 'connection', eventKind: 'disconnect-report-failed' }))) }
  }
  const pending = new Map<number | string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>()
  const send = (message: unknown) => socket.send(JSON.stringify(message))
  const fail = (error: Error) => {
    for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(error) }
    pending.clear()
  }
  const closed = new Promise<void>(resolve => {
    socket.once('error', error => { fail(error) })
    socket.once('close', () => {
      fail(new Error('Codex app-server proxy disconnected'))
      queue = queue.then(() => closing ? undefined : disconnect())
      queue.then(resolve, resolve)
    })
  })
  socket.on('message', data => {
    const line = data.toString()
    queue = queue.then(async () => {
      const message = MessageSchema.parse(JSON.parse(line))
      if (message.id !== undefined && !message.method) {
        const request = pending.get(message.id)
        if (!request) return
        clearTimeout(request.timeout); pending.delete(message.id)
        if (message.error) request.reject(new Error(`Codex protocol error ${message.error.code}: ${message.error.message}`))
        else request.resolve(message.result)
      } else if (message.method && message.id === undefined) {
        await onNotification(message.method, message.params)

      }
    }).catch(async error => { fail(error); try { await disconnect(error) } finally { socket.terminate() } })
  })
  const request = (method: string, params: unknown): Promise<unknown> => new Promise((resolve, reject) => {
    const id = nextId++
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Codex ${method} timed out`)) }, 15000)
    pending.set(id, { resolve, reject, timeout })
    send({ id, method, params })
  })
  const close = async () => { closing = true; socket.terminate(); await closed; await queue }
  try {
    await request('initialize', { clientInfo: { name: 'julia-dashboard', version: '1.0.0' } })
    send({ method: 'initialized', params: {} })
    return { request, close }
  } catch (error) { await close(); throw error }
}

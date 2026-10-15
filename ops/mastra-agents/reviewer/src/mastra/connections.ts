import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ConnectionRecordSchema } from './contracts.ts'
import type { z } from 'zod/v4'

type ConnectionRecord = z.infer<typeof ConnectionRecordSchema>

export class ConnectionStore {
  readonly path: string

  constructor(path: string) {
    this.path = path
  }

  async list(): Promise<ConnectionRecord[]> {
    try {
      return ConnectionRecordSchema.array().parse(JSON.parse(await readFile(this.path, 'utf8')))
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private async save(records: ConnectionRecord[]) {
    const parsed = ConnectionRecordSchema.array().parse(records)
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.path)
  }

  async add(input: ConnectionRecord) {
    const record = ConnectionRecordSchema.parse(input)
    const records = await this.list()
    if (records.some(item => item.id === record.id)) throw new Error(`connection ${record.id} already exists`)
    await this.save([...records, record])
    return record
  }

  async reconnect(id: string, update: { secretReference?: string }) {
    const records = await this.list()
    const index = records.findIndex(item => item.id === id)
    if (index < 0) throw new Error(`connection ${id} not found`)
    records[index] = ConnectionRecordSchema.parse({ ...records[index], ...update, enabled: true })
    await this.save(records)
    return records[index]
  }

  async recordTest(id: string, result: { ok: boolean; modelCount: number }) {
    const records = await this.list()
    const index = records.findIndex(item => item.id === id)
    if (index < 0) throw new Error(`connection ${id} not found`)
    records[index] = ConnectionRecordSchema.parse({ ...records[index], lastTest: { ...result, testedAt: new Date().toISOString() } })
    await this.save(records)
    return records[index]
  }

  async disable(id: string) {
    const records = await this.list()
    const index = records.findIndex(item => item.id === id)
    if (index < 0) throw new Error(`connection ${id} not found`)
    records[index] = ConnectionRecordSchema.parse({ ...records[index], enabled: false })
    await this.save(records)
    return records[index]
  }

  async remove(id: string) {
    const records = await this.list()
    const remaining = records.filter(item => item.id !== id)
    if (remaining.length === records.length) throw new Error(`connection ${id} not found`)
    await this.save(remaining)
  }
}

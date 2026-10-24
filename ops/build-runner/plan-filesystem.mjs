import { resolve } from 'node:path'
import { LocalFilesystem } from '@mastra/core/workspace'

const PLAN_PATH = 'pstack/plan.md'

export class PlanFilesystem extends LocalFilesystem {
  constructor({ basePath }) {
    super({ basePath, contained: true })
  }

  assertPlanPath(inputPath) {
    const target = this.resolveAbsolutePath(inputPath)
    if (target !== resolve(this.basePath, PLAN_PATH)) {
      throw new Error(`plan workspace may write only pstack/plan.md, not ${inputPath} (${target})`)
    }
  }

  async writeFile(inputPath, content, options) {
    this.assertPlanPath(inputPath)
    return super.writeFile(inputPath, content, options)
  }

  async appendFile(inputPath, content) {
    this.assertPlanPath(inputPath)
    return super.appendFile(inputPath, content)
  }

  async deleteFile(inputPath, options) {
    this.assertPlanPath(inputPath)
    return super.deleteFile(inputPath, options)
  }

  async copyFile(src, dest, options) {
    this.assertPlanPath(dest)
    return super.copyFile(src, dest, options)
  }

  async moveFile(src, dest, options) {
    this.assertPlanPath(dest)
    return super.moveFile(src, dest, options)
  }

  async mkdir(inputPath, options) {
    this.assertPlanPath(inputPath)
    return super.mkdir(inputPath, options)
  }

  async rmdir(inputPath, options) {
    this.assertPlanPath(inputPath)
    return super.rmdir(inputPath, options)
  }
}

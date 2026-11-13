import { describe, expect, it } from 'bun:test'
import { fileResponse } from './shared'

describe('fileResponse', () => {
  it('serves a file that is there', async () => {
    const response = fileResponse(import.meta.path)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('fileResponse')
  })

  it('answers 404 for no file', () => {
    expect(fileResponse(null).status).toBe(404)
  })
})

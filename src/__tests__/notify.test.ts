import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSendMessage = vi.fn((..._a: unknown[]) => Promise.resolve())
const mockGetProvider = vi.fn((..._a: unknown[]) => ({
  formatMessage: (t: string) => t,
  splitMessage: (t: string) => [t],
  sendMessage: (...a: unknown[]) => mockSendMessage(...a),
}))

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config.js')>()),
  CHANNEL_PROVIDER: 'telegram',
  CHANNEL_TOKEN: 'test-token',
  CHANNEL_CHAT_ID: 'test-chat',
}))

vi.mock('../channel-provider.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../channel-provider.js')>()),
  getProvider: (...a: unknown[]) => mockGetProvider(...a),
}))

vi.mock('../test-run-marker.js', () => ({
  markIfTestRun: (t: string) => t,
}))

import { notifyChannelOrThrow } from '../notify.js'

describe('notifyChannelOrThrow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendMessage.mockResolvedValue(undefined)
  })

  it('resolves when the provider send succeeds', async () => {
    await expect(notifyChannelOrThrow('hello')).resolves.toBeUndefined()
    expect(mockSendMessage).toHaveBeenCalledWith('test-token', 'test-chat', 'hello', 'HTML')
  })

  it('THROWS when the provider send fails (unlike notifyChannel, which swallows)', async () => {
    mockSendMessage.mockRejectedValueOnce(new Error('Telegram API 500: boom'))
    await expect(notifyChannelOrThrow('hello')).rejects.toThrow('Telegram API 500')
  })

  it('does not retry with a truncated fallback on failure -- one attempt, throw', async () => {
    mockSendMessage.mockRejectedValueOnce(new Error('Telegram API 400: bad request'))
    await expect(notifyChannelOrThrow('hello')).rejects.toThrow()
    expect(mockSendMessage).toHaveBeenCalledTimes(1)
  })
})

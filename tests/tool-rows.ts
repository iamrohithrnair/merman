import type { TestBody, TestOptions, TestRest } from 'claude-code/testing'
import { test as plainTest } from 'claude-code/testing'

export const test = (name: string, ...rest: TestRest): void => {
  const [given, body]: readonly [TestOptions, TestBody] = rest.length === 1 ? [{}, rest[0]] : rest
  plainTest(name, { ...given, options: { toolRows: true, ...given.options } }, body)
}

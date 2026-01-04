import test from 'ava'

import { addNumbers } from '../index'

test('sync function from native code', (t) => {
  const fixture = 42
  t.is(addNumbers(fixture, 100), fixture + 100)
})

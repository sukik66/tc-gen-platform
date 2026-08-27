import assert from 'node:assert/strict'
import test from 'node:test'
import { extractCompleteCaseObjects } from '../server/partial-case-parser.js'

test('complete case extraction handles valid arrays and nested equivalence classes', () => {
  const payload = JSON.stringify({
    cases: [
      { summary: 'Valid value', steps: ['Enter 1'], expected: 'Accepted' },
      { summary: 'Invalid value', steps: ['Enter 0'], expected: 'Rejected', meta: { class: 'invalid' } },
    ],
  })

  assert.deepEqual(extractCompleteCaseObjects(payload).map((item) => item.summary), [
    'Valid value',
    'Invalid value',
  ])
})

test('truncated tail keeps only fully closed boundary cases', () => {
  const payload = '{"cases":['
    + '{"summary":"Minimum","steps":["Enter 1"],"expected":"Accepted"},'
    + '{"summary":"Below minimum","steps":["Enter 0"],"expected":"Rej'

  const extracted = extractCompleteCaseObjects(payload)
  assert.equal(extracted.length, 1)
  assert.equal(extracted[0].summary, 'Minimum')
  assert.equal(extracted[0].expected, 'Accepted')
})

test('case extraction ignores braces and brackets inside strings', () => {
  const payload = '{"cases":[{"summary":"Use {value} and [id]","steps":[],"expected":"OK"},'
  assert.equal(extractCompleteCaseObjects(payload).length, 1)
})

test('an interrupted first case is not promoted into a usable result', () => {
  const payload = '{"cases":[{"summary":"Incomplete","steps":["Enter value"],"expected":"Par'
  assert.deepEqual(extractCompleteCaseObjects(payload), [])
})

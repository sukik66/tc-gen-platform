import test from 'node:test'
import assert from 'node:assert/strict'
import { deleteSkill, getSkillDetail, listSkills, readSkillContext, readSkillFile, saveSkill } from '../server/skills.js'

test('skills support folder-shaped uploads and prompt context', () => {
  const name = `test-skill-${Date.now()}`
  const skill = saveSkill({
    name,
    files: [
      { path: `${name}/SKILL.md`, content: '# Test skill\nUse boundary values.' },
      { path: `${name}/references/checklist.md`, content: '- Check lower and upper bounds.' },
    ],
  })
  try {
    assert.equal(skill.name, name)
    assert.equal(skill.fileCount, 2)
    assert.equal(skill.hasSkillMd, true)
    assert.deepEqual(getSkillDetail(skill.id)?.files.map((file) => file.path), [
      `${name}/SKILL.md`,
      `${name}/references/checklist.md`,
    ])
    assert.match(readSkillFile(skill.id, `${name}/SKILL.md`).content, /boundary values/)
    const context = readSkillContext([skill.id])
    assert.match(context, /Use boundary values/)
    assert.match(context, /lower and upper bounds/)
  } finally {
    deleteSkill(skill.id)
  }
})

test('skills reject traversal paths and require explicit replacement', () => {
  assert.throws(() => saveSkill({ name: 'bad-path', files: [{ path: '../SKILL.md', content: 'x' }] }), /路径不合法/)
  const name = `replace-skill-${Date.now()}`
  const first = saveSkill({ name, files: [{ path: 'SKILL.md', content: 'one' }] })
  try {
    assert.throws(() => saveSkill({ name, files: [{ path: 'SKILL.md', content: 'two' }] }), (error) => error.code === 'SKILL_EXISTS')
    const replaced = saveSkill({ name, files: [{ path: 'SKILL.md', content: 'two' }], replace: true, id: first.id })
    assert.equal(replaced.id, first.id)
    assert.match(readSkillContext([first.id]), /two/)
  } finally {
    deleteSkill(first.id)
  }
})

test('skill list does not expose file contents', () => {
  for (const skill of listSkills()) {
    assert.equal('files' in skill, false)
    assert.equal('content' in skill, false)
  }
})

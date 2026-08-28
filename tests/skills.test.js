import test from 'node:test'
import assert from 'node:assert/strict'
import { deleteSkill, getSkillDetail, getSkillVersion, listSkillVersions, listSkills, readSkillContext, readSkillFile, readSkillVersionFile, restoreSkillVersion, saveSkill } from '../server/skills.js'

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

test('skill versions increment and restore creates a new current version', () => {
  const name = `version-skill-${Date.now()}`
  const first = saveSkill({ name, files: [{ path: 'SKILL.md', content: 'version one' }] })
  try {
    assert.equal(first.currentVersion, 1)
    const second = saveSkill({ name, id: first.id, replace: true, files: [{ path: 'SKILL.md', content: 'version two' }] })
    assert.equal(second.currentVersion, 2)
    assert.deepEqual(listSkillVersions(first.id).map((version) => version.version), [2, 1])
    assert.match(getSkillVersion(first.id, 1).files.map((file) => file.path).join(','), /SKILL\.md/)
    const restored = restoreSkillVersion(first.id, 1)
    assert.equal(restored.currentVersion, 3)
    assert.match(readSkillFile(first.id, 'SKILL.md').content, /version one/)
    assert.match(readSkillVersionFile(first.id, 2, 'SKILL.md').content, /version two/)
    assert.deepEqual(listSkillVersions(first.id).map((version) => version.version), [3, 2, 1])
  } finally {
    deleteSkill(first.id)
  }
})

test('version-suffixed upload names require explicit replacement of the base skill', () => {
  const name = `suffix-skill-${Date.now()}`
  const first = saveSkill({ name, files: [{ path: 'SKILL.md', content: 'base' }] })
  try {
    assert.throws(
      () => saveSkill({ name: `${name}-v7.0`, files: [{ path: 'SKILL.md', content: 'next' }] }),
      (error) => error.code === 'SKILL_EXISTS' && error.existing.id === first.id,
    )
  } finally {
    deleteSkill(first.id)
  }
})

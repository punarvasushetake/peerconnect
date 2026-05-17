const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

const { difficultyToProficiency } = require('../src/services/courseSkill.service');

test('difficultyToProficiency maps course difficulty to skill stars', () => {
  assert.equal(difficultyToProficiency('beginner'), 1);
  assert.equal(difficultyToProficiency('intermediate'), 3);
  assert.equal(difficultyToProficiency('advanced'), 5);
});

test('difficultyToProficiency defaults unknown difficulty to beginner proficiency', () => {
  assert.equal(difficultyToProficiency(undefined), 1);
  assert.equal(difficultyToProficiency('custom'), 1);
});

import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  feedbackTrackingPath,
  formatFeedbackStatusLabel,
  feedbackStoragePaths,
  feedbackDatabasePath,
  feedbackFilename,
  feedbackIdFromFilename,
  isFeedbackStatus,
  parseFeedbackStatus,
  normalizePagePath
} from '../../src/lib/feedback.ts';

test('normalizePagePath strips origin while preserving path and query', () => {
  assert.equal(normalizePagePath('https://thevernissage.art/artworks/water-lilies-1906?ref=feed'), '/artworks/water-lilies-1906?ref=feed');
  assert.equal(normalizePagePath('/artists/claude-monet'), '/artists/claude-monet');
  assert.equal(normalizePagePath('   '), '');
  assert.equal(normalizePagePath('not a valid url'), 'not a valid url');
});

test('feedback filename helpers round-trip a feedback id', () => {
  const id = '20260409210000123456';
  const filename = feedbackFilename(id);

  assert.equal(filename, 'feedback_20260409210000123456.json');
  assert.equal(feedbackIdFromFilename(filename), id);
  assert.equal(feedbackIdFromFilename(' notes.json '), '');
});

test('feedbackDatabasePath honors default, relative, and absolute file urls', () => {
  const original = process.env.FEEDBACK_DATABASE_URL;
  const projectRoot = '/tmp/vernissage-specimen';
  const absolutePath = '/var/lib/vernissage/feedback.db';

  try {
    delete process.env.FEEDBACK_DATABASE_URL;
    assert.equal(feedbackDatabasePath(projectRoot), path.join(projectRoot, 'data', 'vernissage-feedback.db'));

    process.env.FEEDBACK_DATABASE_URL = 'file:./runtime/feedback.db';
    assert.equal(feedbackDatabasePath(projectRoot), path.resolve(projectRoot, './runtime/feedback.db'));

    process.env.FEEDBACK_DATABASE_URL = `file:${absolutePath}`;
    assert.equal(feedbackDatabasePath(projectRoot), absolutePath);
  } finally {
    if (original === undefined) {
      delete process.env.FEEDBACK_DATABASE_URL;
    } else {
      process.env.FEEDBACK_DATABASE_URL = original;
    }
  }
});

test('feedbackStoragePaths follows the configured feedback database directory', () => {
  const original = process.env.FEEDBACK_DATABASE_URL;
  const projectRoot = '/tmp/vernissage-specimen';

  try {
    delete process.env.FEEDBACK_DATABASE_URL;
    assert.deepEqual(feedbackStoragePaths(projectRoot), {
      feedbackDir: path.join(projectRoot, 'data', 'feedback'),
      addressedDir: path.join(projectRoot, 'data', 'feedback', 'addressed')
    });

    process.env.FEEDBACK_DATABASE_URL = 'file:/data/vernissage-feedback.db';
    assert.deepEqual(feedbackStoragePaths(projectRoot), {
      feedbackDir: '/data/feedback',
      addressedDir: '/data/feedback/addressed'
    });
  } finally {
    if (original === undefined) {
      delete process.env.FEEDBACK_DATABASE_URL;
    } else {
      process.env.FEEDBACK_DATABASE_URL = original;
    }
  }
});

test('feedback status helpers accept known values and format labels', () => {
  assert.equal(isFeedbackStatus('open'), true);
  assert.equal(isFeedbackStatus('in_progress'), true);
  assert.equal(isFeedbackStatus('mystery'), false);
  assert.equal(parseFeedbackStatus('planned'), 'planned');
  assert.equal(parseFeedbackStatus(' shipped '), 'shipped');
  assert.equal(parseFeedbackStatus('done'), null);
  assert.equal(formatFeedbackStatusLabel('open'), 'Open');
  assert.equal(formatFeedbackStatusLabel('planned'), 'Planned');
  assert.equal(formatFeedbackStatusLabel('in_progress'), 'In progress');
  assert.equal(formatFeedbackStatusLabel('shipped'), 'Shipped');
});

test('feedbackTrackingPath builds a private tracking url', () => {
  assert.equal(feedbackTrackingPath('abc123'), '/feedback/updates?token=abc123');
  assert.equal(feedbackTrackingPath(' token with spaces '), '/feedback/updates?token=token%20with%20spaces');
  assert.equal(feedbackTrackingPath('   '), '/feedback/updates');
});

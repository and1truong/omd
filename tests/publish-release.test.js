import test from 'node:test';
import assert from 'node:assert/strict';
import { publishRelease } from '../scripts/publish-release.mjs';

const commit = 'a'.repeat(40), otherCommit = 'b'.repeat(40), tag = 'v0.0.1';
const options = { repository: 'and1truong/omd', tag, commit,
  assets: ['release/omd-v0.0.1.zip', 'release/omd-v0.0.1.tar.gz', 'release/SHA256SUMS.txt'] };
const draft = () => ({ tag_name: tag, target_commitish: commit, draft: true });

// Model remote state across runs, including partial create/upload and failed publication.
function remote(state = {}) {
  const calls = [], uploaded = new Set();
  const fail = phase => {
    if (state.fail === phase) { state.fail = null; throw new Error(`Transient ${phase} failure`); }
  };
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (command === 'git') {
      fail('tag');
      if (!state.taggedCommit) throw Object.assign(new Error('No tag'), { status: 2 });
      const ref = `refs/tags/${tag}`;
      return state.annotated ? `${otherCommit}\t${ref}\n${state.taggedCommit}\t${ref}^{}\n` : `${state.taggedCommit}\t${ref}\n`;
    }
    if (args[0] === 'api') {
      fail('list');
      // The matching draft can be on a later page.
      return JSON.stringify([[{ ...draft(), tag_name: 'v9.9.9' }], state.release ? [state.release] : []]);
    }
    const action = args[1];
    if (action === 'create') {
      assert.equal(state.release, undefined);
      state.release = draft();
      if (state.createTag) state.taggedCommit = commit;
      fail('create');
    }
    if (action === 'create' || action === 'upload') {
      assert.equal(state.release.draft, true);
      for (const asset of options.assets) { assert.ok(args.includes(asset)); uploaded.add(asset); }
      fail('upload');
    }
    if (action === 'edit') {
      fail('edit');
      assert.deepEqual([...uploaded], options.assets);
      state.release.draft = false;
      state.taggedCommit = commit;
    }
    return '';
  };
  return { state, calls, run, mutations: () => calls.filter(call => call[0] === 'gh' && call[1] === 'release') };
}

test('new release creates a draft with all assets before publication', () => {
  const github = remote();
  publishRelease({ ...options, run: github.run });
  assert.equal(github.state.release.draft, false);
  assert.deepEqual(github.mutations().map(call => call[2]), ['create', 'edit']);
  assert.ok(github.mutations()[0].includes(commit));
});

for (const createTag of [false, true]) {
  for (const phase of ['create', 'upload', 'edit']) {
    test(`retry recovers failed ${phase} with ${createTag ? 'an existing' : 'no existing'} tag`, () => {
      const github = remote({ createTag, fail: phase });
      assert.throws(() => publishRelease({ ...options, run: github.run }), /Transient/);
      assert.equal(github.state.release.draft, true);
      publishRelease({ ...options, run: github.run });
      assert.equal(github.state.release.draft, false);
      assert.equal(github.mutations().filter(call => call[2] === 'create').length, 1);
      const upload = github.mutations().find(call => call[2] === 'upload');
      assert.ok(upload.includes('--clobber'));
    });
  }
}

test('same-commit annotated tag can resume a draft', () => {
  const github = remote({ release: draft(), taggedCommit: commit, annotated: true });
  publishRelease({ ...options, run: github.run });
  assert.deepEqual(github.mutations().map(call => call[2]), ['upload', 'edit']);
});

for (const [name, state] of [
  ['published release', { release: { ...draft(), draft: false }, taggedCommit: commit }],
  ['tag without a draft', { taggedCommit: commit }],
  ['draft for another commit', { release: { ...draft(), target_commitish: otherCommit }, taggedCommit: commit }],
  ['draft with a conflicting tag', { release: draft(), taggedCommit: otherCommit }],
  ['release lookup failure', { fail: 'list' }],
  ['tag lookup failure', { fail: 'tag', release: draft() }],
]) {
  test(`${name} prevents all release mutations`, () => {
    const github = remote(state);
    assert.throws(() => publishRelease({ ...options, run: github.run }));
    assert.deepEqual(github.mutations(), []);
  });
}

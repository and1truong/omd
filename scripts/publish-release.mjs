import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const execute = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

export function publishRelease({ repository, tag, commit, assets, run = execute }) {
  if (!repository || !/^v\d+\.\d+\.\d+$/.test(tag) || !/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error('Release requires a repository, stable version tag and tested commit SHA.');
  }
  // Listing releases includes unpublished drafts. API failures must stop publication.
  const releases = JSON.parse(run('gh', ['api', `repos/${repository}/releases`, '--paginate', '--slurp'])).flat();
  const release = releases.find(item => item.tag_name === tag);
  let refs;
  try {
    refs = run('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  } catch (error) {
    if (error.status !== 2) throw error;
    refs = '';
  }
  const lines = refs.trim().split('\n').filter(Boolean).map(line => line.split('\t'));
  // An annotated tag's peeled SHA identifies the commit, not the tag object.
  const taggedCommit = (lines.find(([, ref]) => ref === `refs/tags/${tag}^{}`) ?? lines[0])?.[0];
  if (release) {
    if (release.draft !== true) throw new Error(`Release ${tag} is already published; refusing to replace it.`);
    if (release.target_commitish !== commit || (taggedCommit && taggedCommit !== commit)) {
      throw new Error(`Draft ${tag} does not target the tested commit; refusing to publish it.`);
    }
    // A failed create/upload may leave an incomplete draft. Refresh only this same-commit draft.
    run('gh', ['release', 'upload', tag, ...assets, '--clobber', '--repo', repository]);
  } else {
    if (taggedCommit) throw new Error(`Tag ${tag} already exists; refusing to replace it.`);
    run('gh', ['release', 'create', tag, ...assets, '--target', commit, '--title', `omd ${tag}`, '--draft',
      '--notes-file', `docs/releases/${tag}.md`, '--repo', repository]);
  }
  run('gh', ['release', 'edit', tag, '--draft=false', '--latest', '--repo', repository]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tag = process.env.RELEASE_TAG;
  const names=readFileSync('release/SHA256SUMS.txt','utf8').trim().split('\n').map(line=>{
    const match=/^[a-f0-9]{64}  ([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(line);
    if(!match)throw new Error('Invalid release checksum entry.');return match[1];
  });
  publishRelease({ repository: process.env.GH_REPO, tag, commit: process.env.GITHUB_SHA,
    assets: [...names.map(name=>`release/${name}`), 'release/SHA256SUMS.txt'] });
}

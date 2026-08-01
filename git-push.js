/**
 * Push files to rskzayton/st-token-monitor via GitHub Git Data API
 *
 * Files are stored locally under code/ but pushed to the repo root
 * (no code/ prefix in the remote tree).
 *
 * Usage: node code/git-push.js
 *
 * Prerequisites:
 *   - `gh` CLI installed and authenticated
 */
const { execSync } = require('child_process');
const fs = require('fs');

const OWNER   = 'rskzayton';
const REPO    = 'st-token-monitor';
const API     = `repos/${OWNER}/${REPO}`;
const BRANCH  = 'main';
const VERSION = 'v1.1.1';

// Local source path → remote target path
const ENTRIES = [
    { local: 'code/manifest.json',   remote: 'manifest.json' },
    { local: 'code/index.js',        remote: 'index.js' },
    { local: 'code/style.css',       remote: 'style.css' },
    { local: 'code/server-patch.js', remote: 'server-patch.js' },
    { local: 'code/README.md',       remote: 'README.md' },
    { local: 'code/git-push.js',     remote: 'git-push.js' },
];

function ghPost(endpoint, body, jq) {
    const bodyStr = JSON.stringify(body);
    const jqFlag = jq ? ` --jq "${jq}"` : '';
    const cmd = `gh api -X POST ${endpoint} --input -${jqFlag}`;
    const out = execSync(cmd, { input: bodyStr, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    return out.trim();
}

function ghPatch(endpoint, body, jq) {
    const bodyStr = JSON.stringify(body);
    const jqFlag = jq ? ` --jq "${jq}"` : '';
    const cmd = `gh api -X PATCH ${endpoint} --input -${jqFlag}`;
    const out = execSync(cmd, { input: bodyStr, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    return out.trim();
}

async function run() {
    console.log(`=== Push ${VERSION} to ${OWNER}/${REPO} (files at repo root) ===\n`);

    // Step 1: Get current HEAD commit
    console.log('1. Getting current ref...');
    let parentSha;
    try {
        parentSha = execSync(
            `gh api ${API}/git/ref/heads/${BRANCH} --jq .object.sha`,
            { encoding: 'utf-8' }
        ).trim();
        console.log(`   HEAD: ${parentSha}`);
    } catch {
        console.log('   Branch not found, will create initial commit.');
        parentSha = null;
    }

    // Step 2: Create blobs for each file
    console.log('\n2. Creating blobs (remote path → local source)...');
    const treeEntries = [];
    for (const { local, remote } of ENTRIES) {
        const content = fs.readFileSync(local, 'utf-8');
        const base64 = Buffer.from(content, 'utf-8').toString('base64');
        console.log(`   ${remote} ← ${local} (${content.length} chars)`);

        const blobSha = ghPost(`${API}/git/blobs`, {
            content: base64,
            encoding: 'base64',
        }, '.sha');

        console.log(`   → SHA: ${blobSha}`);
        treeEntries.push({
            path: remote,
            mode: '100644',
            type: 'blob',
            sha: blobSha,
        });
    }

    // Step 3: Create tree (no base_tree — we want a clean tree at root,
    //         so the old code/ directory is no longer tracked)
    console.log('\n3. Creating tree (clean root, no code/ prefix)...');
    const newTreeSha = ghPost(`${API}/git/trees`, { tree: treeEntries }, '.sha');
    console.log(`   New tree: ${newTreeSha}`);

    // Step 4: Create commit
    console.log('\n4. Creating commit...');
    const commitBody = {
        message: `${VERSION}: fix top-level await crash, switch tokenizer to runtime detection (window.tokenizers)`,
        tree: newTreeSha,
        parents: parentSha ? [parentSha] : [],
    };
    const commitSha = ghPost(`${API}/git/commits`, commitBody, '.sha');
    console.log(`   Commit: ${commitSha}`);

    // Step 5: Update ref
    console.log('\n5. Updating ref...');
    const refBody = { sha: commitSha, force: false };
    const refResult = ghPatch(`${API}/git/refs/heads/${BRANCH}`, refBody, '.ref');
    console.log(`   Ref updated: ${refResult}`);

    console.log(`\n=== Push complete! ===`);
    console.log(`https://github.com/${OWNER}/${REPO}/commit/${commitSha}`);
}

run().catch(err => {
    console.error('Push failed:', err.message);
    process.exit(1);
});

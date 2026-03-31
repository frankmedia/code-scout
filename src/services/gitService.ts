import { executeCommand, isTauri } from '@/lib/tauri';
import { useGitStore } from '@/store/gitStore';

/**
 * Refresh the git status for a given project path and update the git store.
 */
export async function refreshGitStatus(projectPath: string): Promise<void> {
  if (!isTauri()) return;

  const { setGitStatus, clearGitStatus } = useGitStore.getState();

  try {
    // Check if this is a git repo at all
    const revParseCheck = await executeCommand('git rev-parse --git-dir', projectPath);
    if (revParseCheck.code !== 0) {
      clearGitStatus();
      return;
    }

    // Get current branch
    const branchResult = await executeCommand('git rev-parse --abbrev-ref HEAD', projectPath);
    const branch = branchResult.code === 0 ? branchResult.stdout.trim() : null;

    // Check for uncommitted changes
    const statusResult = await executeCommand('git status --porcelain', projectPath);
    const isDirty = statusResult.code === 0 && statusResult.stdout.trim().length > 0;

    // Get ahead count (commits ahead of remote)
    let aheadCount = 0;
    const aheadResult = await executeCommand('git rev-list @{u}..HEAD --count', projectPath);
    if (aheadResult.code === 0) {
      const parsed = parseInt(aheadResult.stdout.trim(), 10);
      if (!isNaN(parsed)) aheadCount = parsed;
    }

    // Get remote URL
    const remoteResult = await executeCommand('git remote get-url origin', projectPath);
    const hasRemote = remoteResult.code === 0 && remoteResult.stdout.trim().length > 0;
    const remoteUrl = hasRemote ? remoteResult.stdout.trim() : null;

    setGitStatus({ branch, isDirty, aheadCount, hasRemote, remoteUrl });
  } catch {
    clearGitStatus();
  }
}

/**
 * Push to origin, injecting the PAT into the HTTPS URL if needed.
 */
export async function gitPush(
  projectPath: string,
  token: string,
  remoteUrl: string,
): Promise<void> {
  if (!isTauri()) throw new Error('gitPush requires Tauri desktop');

  let pushUrl = remoteUrl;

  // Inject the PAT for HTTPS GitHub remotes
  if (remoteUrl.startsWith('https://github.com/')) {
    pushUrl = remoteUrl.replace('https://github.com/', `https://${token}@github.com/`);
  } else if (remoteUrl.startsWith('https://')) {
    // Generic HTTPS — inject token before the host
    pushUrl = remoteUrl.replace('https://', `https://${token}@`);
  }

  // Temporarily set the remote URL with the token, push, then restore
  const setUrlCmd = `git remote set-url origin "${pushUrl}"`;
  const restoreCmd = `git remote set-url origin "${remoteUrl}"`;

  try {
    await executeCommand(setUrlCmd, projectPath);
    const pushResult = await executeCommand('git push origin HEAD', projectPath);
    if (pushResult.code !== 0) {
      throw new Error(`git push failed: ${pushResult.stderr || pushResult.stdout}`);
    }
  } finally {
    // Always restore the original remote URL (without token)
    await executeCommand(restoreCmd, projectPath).catch(() => {});
  }
}

/**
 * Stage all changes and create a commit with the given message.
 */
export async function gitCommitAll(projectPath: string, message: string): Promise<void> {
  if (!isTauri()) throw new Error('gitCommitAll requires Tauri desktop');

  const safeMessage = message.replace(/"/g, '\\"');
  const result = await executeCommand(`git add -A && git commit -m "${safeMessage}"`, projectPath);

  if (result.code !== 0) {
    throw new Error(`git commit failed: ${result.stderr || result.stdout}`);
  }
}

/**
 * Create a new GitHub repository via the API. Returns the clone URL on success.
 */
export async function createGithubRepo(
  repoName: string,
  token: string,
  isPrivate: boolean,
): Promise<string> {
  const response = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: JSON.stringify({ name: repoName, private: isPrivate, auto_init: false }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = (err as { message?: string }).message ?? response.statusText;
    if (msg.includes('not accessible by personal access token') || response.status === 403) {
      throw new Error(
        'Token lacks permission to create repos. Use a Classic token with "repo" scope, or a Fine-grained token with "Administration: Write" permission.'
      );
    }
    throw new Error(`Failed to create GitHub repo: ${msg}`);
  }

  const data = (await response.json()) as { clone_url: string };
  return data.clone_url;
}

/**
 * Validate a GitHub PAT by calling /user. Returns user info or null on failure.
 */
export async function connectGithubWithToken(
  token: string,
): Promise<{ login: string } | null> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { login: string };
    return { login: data.login };
  } catch {
    return null;
  }
}

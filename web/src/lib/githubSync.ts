import type { Progress, SyncConfig } from '../types';
import { emptyProgress, mergeProgress, parseProgress, sameProgress } from './progress';

type Fetch = typeof fetch;

export class ConflictError extends Error {}

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function headers(cfg: SyncConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function contentsUrl(cfg: SyncConfig): string {
  const path = cfg.path.split('/').map(encodeURIComponent).join('/');
  const ref = cfg.branch ? `?ref=${encodeURIComponent(cfg.branch)}` : '';
  return `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}${ref}`;
}

export function isConfigured(cfg: SyncConfig): boolean {
  return Boolean(cfg.owner.trim() && cfg.repo.trim() && cfg.path.trim() && cfg.token.trim());
}

async function failure(res: Response, what: string): Promise<Error> {
  let detail = '';
  try {
    detail = ((await res.json()) as { message?: string }).message ?? '';
  } catch {
    /* ignore */
  }
  if (res.status === 401) return new Error(`${what}: the token was rejected (401). Check or renew it.`);
  if (res.status === 403 || res.status === 404)
    return new Error(`${what}: no access (${res.status}). Check owner/repo and that the token can read and write the repository's contents. ${detail}`);
  return new Error(`${what}: HTTP ${res.status} ${detail}`);
}

/** Read progress.json from the private repo. `null` progress = file does not exist yet. */
export async function pullRemote(
  cfg: SyncConfig,
  f: Fetch = fetch,
): Promise<{ progress: Progress | null; sha: string | null }> {
  const res = await f(contentsUrl(cfg), { headers: headers(cfg), cache: 'no-store' });
  if (res.status === 404) {
    // 404 also means "wrong repo / no access"; distinguish by probing the repo itself
    const probe = await f(
      `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`,
      { headers: headers(cfg), cache: 'no-store' },
    );
    if (!probe.ok) throw await failure(probe, 'Sync');
    return { progress: null, sha: null };
  }
  if (!res.ok) throw await failure(res, 'Sync');
  const body = (await res.json()) as { sha: string; content?: string; encoding?: string };
  let text: string;
  if (body.encoding === 'base64' && body.content) {
    text = base64ToUtf8(body.content);
  } else {
    // files over 1 MB are not inlined by the contents API: fetch the blob instead
    const blob = await f(
      `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/git/blobs/${body.sha}`,
      { headers: headers(cfg), cache: 'no-store' },
    );
    if (!blob.ok) throw await failure(blob, 'Sync');
    text = base64ToUtf8(((await blob.json()) as { content: string }).content);
  }
  let parsed: Progress | null = null;
  try {
    parsed = parseProgress(JSON.parse(text));
  } catch {
    parsed = null;
  }
  // An empty/placeholder file (e.g. "{}") counts as "no progress yet".
  return { progress: parsed, sha: body.sha };
}

export async function pushRemote(
  cfg: SyncConfig,
  progress: Progress,
  sha: string | null,
  f: Fetch = fetch,
): Promise<string> {
  const res = await f(contentsUrl(cfg).split('?')[0], {
    method: 'PUT',
    headers: { ...headers(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `progress ${new Date().toISOString().slice(0, 10)}`,
      content: utf8ToBase64(JSON.stringify(progress)),
      ...(sha ? { sha } : {}),
      ...(cfg.branch ? { branch: cfg.branch } : {}),
    }),
  });
  if (res.status === 409 || res.status === 422) throw new ConflictError('progress.json changed on another device');
  if (!res.ok) throw await failure(res, 'Saving progress');
  return ((await res.json()) as { content: { sha: string } }).content.sha;
}

/** Pull, merge with the local copy, push if the merge differs from the remote. */
export async function syncProgress(
  cfg: SyncConfig,
  local: Progress,
  f: Fetch = fetch,
): Promise<Progress> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { progress: remote, sha } = await pullRemote(cfg, f);
    const merged = remote ? mergeProgress(local, remote) : local;
    if (remote && sameProgress(merged, remote)) return merged; // remote already up to date
    if (!remote && Object.keys(local.words).length === 0 && local.done.length === 0) return merged;
    try {
      await pushRemote(cfg, merged, sha, f);
      return merged;
    } catch (e) {
      if (!(e instanceof ConflictError) || attempt === 2) throw e;
      local = merged; // someone else wrote in between: pull again and re-merge
    }
  }
  return local;
}

export { emptyProgress };

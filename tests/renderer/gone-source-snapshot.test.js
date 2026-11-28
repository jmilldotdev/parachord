/**
 * A kept-updated playlist whose source is gone for good becomes a snapshot
 * (#1519 follow-up, 2026-11-28). ListenBrainz deletes old Daily Jams, so a
 * saved one loses its source after a few days; it kept its tracks but stayed
 * "Auto-update · On" and retried every hour forever.
 *
 * Gone means the service SAYS so: a plug-in's lookupPlaylist throws with
 * `reason: 'not-found'` (the convention plug-ins already use for
 * 'plan-ineligible'), and a hosted XSPF's server answers 404 or 410. Then the
 * playlist switches to a snapshot, keeping its tracks, and a toast says so
 * once. Any other failure (offline, signed out, a 500) keeps retrying.
 */
const fs = require('fs');
const path = require('path');
const M = require('../../src/renderer/lib/playlist-update-mode');

const ROOT = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('lib/playlist-update-mode.js', () => {
  test('gone only when the service says so', () => {
    expect(M.isSourceGone(Object.assign(new Error('x'), { reason: 'not-found' }))).toBe(true);
    expect(M.isSourceGone(new Error('Failed to fetch the ListenBrainz playlist: 500'))).toBe(false);
    expect(M.isSourceGone(Object.assign(new Error('x'), { reason: 'plan-ineligible' }))).toBe(false);
    expect(M.isSourceGone(null)).toBe(false);
  });

  test('a hosted document is gone on 404 or 410, never on anything else', () => {
    expect(M.hostedStatusIsGone(404)).toBe(true);
    expect(M.hostedStatusIsGone(410)).toBe(true);
    for (const s of [0, 401, 403, 429, 500, 503]) expect(M.hostedStatusIsGone(s)).toBe(false);
  });

  test('what the toast says', () => {
    expect(M.goneSnapshotMessage('Daily Jams', 'ListenBrainz'))
      .toBe('“Daily Jams” is no longer on ListenBrainz, so it’s now a snapshot. Its tracks are kept.');
    expect(M.goneSnapshotMessage('Mix', null))
      .toBe('“Mix” is no longer at its link, so it’s now a snapshot. Its tracks are kept.');
  });
});

describe('ListenBrainz says when a playlist is gone', () => {
  const lb = require('../../plugins-src/listenbrainz/implementation');
  const URL = 'https://listenbrainz.org/playlist/00000000-0000-4000-8000-000000000000/';
  afterEach(() => { delete global.fetch; });

  test('a 404 is not-found', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    await expect(lb.lookupPlaylist(URL, {})).rejects.toMatchObject({ reason: 'not-found' });
    expect(global.fetch).toHaveBeenCalledTimes(1); // not retried
  });

  test('anything else is a plain failure', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const err = await lb.lookupPlaylist(URL, {}).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.reason).toBeUndefined();
  });

  test('its manifest version moved with the change', () => {
    const m = JSON.parse(read('plugins-src/listenbrainz/manifest.json'));
    expect(m.manifest.version).toBe('1.6.14');
  });
});

describe('app.js', () => {
  const app = read('src/renderer/app.js');
  test('a hosted document\'s 404 or 410 is not-found', () => {
    const fn = app.slice(app.indexOf('const fetchHostedPlaylistText = async (url) => {'), app.indexOf('const handleImportPlaylistFromUrl = async'));
    expect(fn).toContain('if (!result.ok) throw Object.assign(new Error(`Failed to fetch: ${result.status}`), hostedStatusIsGone(result.status) ? { reason: \'not-found\' } : {});');
  });

  test('one handler turns a gone source into a snapshot, for both pollers and Refresh now', () => {
    const fn = app.slice(app.indexOf('const snapshotGoneSource = async (playlist, error) => {'), app.indexOf('\n  };\n', app.indexOf('const snapshotGoneSource')));
    expect(fn).toContain('if (!isSourceGone(error) || !playlist) return false;');
    expect(fn).toContain("if (playlistUpdateMode(playlist, { providerImported }) !== 'auto') return false;");
    expect(fn).toContain("await setPlaylistUpdateMode(playlist.id, 'snapshot', { quiet: true });");
    expect(fn).toContain('showToast(goneSnapshotMessage(playlist.title, resolverId ? pluginName(resolverId) : null));');
    const refresh = app.slice(app.indexOf('const refreshHostedPlaylist = async'), app.indexOf('\n  };\n', app.indexOf('const refreshHostedPlaylist = async')));
    expect(refresh).toContain('if (await snapshotGoneSource(playlist, error)) return false;');
    const poll = app.slice(app.indexOf('const pollHostedPlaylists = async'), app.indexOf('// Poll every 5 minutes.'));
    expect(poll).toContain('if (await snapshotGoneSource(playlist, error)) continue;');
  });

  test('switching to a snapshot can skip its own toast', () => {
    expect(app).toContain("const setPlaylistUpdateMode = async (playlistId, mode, { quiet = false } = {}) => {");
    expect(app).toContain('} else if (!quiet) {');
  });
});

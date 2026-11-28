/**
 * A kept-updated playlist (a saved recommended playlist, a link import with
 * Auto-update on) is never deleted or emptied when its source goes away:
 *   - turning Auto-update off keeps the last tracks as a snapshot;
 *   - a refresh that fails (the service signed out or removed, the source
 *     playlist deleted, e.g. an old ListenBrainz Daily Jams) leaves the saved
 *     playlist as it was, and tries again in an hour;
 *   - a refresh that finds no tracks throws instead of saving an empty list.
 * Checked in the app on 2026-11-28 (a ListenBrainz playlist: switched off,
 * relaunched, and refreshed against a source that doesn't exist; all 50
 * tracks kept each time). These pin the code that makes it so.
 */
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const slice = (from, to) => {
  const i = app.indexOf(from);
  expect(i).toBeGreaterThan(-1);
  return app.slice(i, app.indexOf(to, i));
};

test('turning Auto-update off saves the whole playlist, its tracks included, as a snapshot', () => {
  const fn = slice('const setPlaylistUpdateMode = async (playlistId, mode, { quiet = false } = {}) => {', '\n  };\n');
  expect(fn).toContain("const updated = { ...playlist, autoUpdate: mode === 'auto' };");
  expect(fn).toContain('await window.electron.playlists.save(window.buildPlaylistSavePayload(updated));');
  expect(fn).not.toMatch(/tracks:\s*\[\]/);
  expect(fn).not.toMatch(/deletePlaylist|playlists\.delete/);
});

test('a failed refresh leaves the saved playlist alone', () => {
  const fn = slice('const refreshHostedPlaylist = async (playlistId, { background = false } = {}) => {', '\n  };\n');
  const onError = fn.slice(fn.indexOf('} catch (error) {'));
  expect(onError).toContain('return false;');
  expect(onError).not.toMatch(/setPlaylists|playlists\.save|playlists\.delete|setPlaylistTracks/);
});

test('a refresh that finds no tracks throws instead of saving an empty playlist', () => {
  const fn = slice('const handleImportPlaylistFromUrl = async', 'const handlePlaylistDrop = async');
  expect(fn).toMatch(/if \(!parsed \|\| !parsed\.tracks\?\.length\) \{[\s\S]{0,400}if \(background \|\| quiet\) \{\s*throw new Error/);
  // The refresh asks quietly, so it always takes that throw.
  expect(app).toContain('await handleImportPlaylistFromUrl(playlist.sourceUrl, false, null, null, { quiet: true, provider });');
});

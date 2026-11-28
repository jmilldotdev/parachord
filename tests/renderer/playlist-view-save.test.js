/**
 * The ephemeral-playlist SAVE button (PlaylistViewPage): a provider playlist
 * (a recommended playlist opened from the Recommendations page) saves through
 * saveServicePlaylist (lib/save-service-playlist.js, the link import), the
 * same save as the card's right-click "Save to Playlists" (#1659), and the
 * Weekly Jams record spreads the whole playlist (buildPlaylistSavePayload's
 * rule: a field left out of a hand-picked list is deleted when the store
 * replaces the record).
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/playlist-view-page.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

describe('the ephemeral playlist SAVE button', () => {
  const saveStart = src.indexOf('selectedPlaylist?.isEphemeral && !playlistEditMode && React.createElement');
  const saveEnd = src.indexOf("bg-orange-500", saveStart);
  const save = src.slice(saveStart, saveEnd);

  test('a provider playlist saves through the one shared save (the card\'s Save to Playlists runs it too)', () => {
    expect(saveStart).toBeGreaterThan(-1);
    expect(save).toContain('if (selectedPlaylist.sourceUrl) {');
    // The cover this view shows rides along, so the saved record keeps it.
    expect(save).toContain('await saveServicePlaylist({ url: selectedPlaylist.sourceUrl, name: selectedPlaylist.title, coverArt: selectedPlaylist.coverArt || null });');
    // And that save is the link import with the cover as its 4th argument
    // (url, skipStorageUpdate, storedAddedAt, metadataOverrides).
    expect(app).toContain('importFromUrl: (link, overrides, opts) => handleImportPlaylistFromUrl(link, false, null, overrides, opts),');
  });

  test('the Weekly Jams record spreads the whole playlist, no hand-picked field list', () => {
    const recStart = save.indexOf('const newPlaylist = {');
    const rec = save.slice(recStart, save.indexOf('setPlaylists(prev => [...prev, newPlaylist]', recStart));
    expect(rec).toContain('...selectedPlaylist');
    // The library-record specifics are overridden, the rest inherited.
    expect(rec).toContain('title: selectedPlaylist.weekLabel');
    expect(rec).toContain("creator: selectedPlaylist.creator || 'ListenBrainz'");
    expect(rec).toContain('tracks: playlistTracks');
    // The ephemeral flag must not leak into the saved library record.
    expect(rec).toContain('delete newPlaylist.isEphemeral');
  });

  test('saveServicePlaylist is threaded as a stable handler on both sides', () => {
    // The handlers list and the props destructure in playlist-view-page.js…
    expect(src).toMatch(/PLAYLIST_VIEW_PAGE_HANDLERS = \[[\s\S]*'saveServicePlaylist'/);
    expect(src).toMatch(/^\s{4}saveServicePlaylist,$/m);
    // …and the useStableHandlers call in app.js (keys must match).
    expect(app).toMatch(/savePlaylistToStore, saveServicePlaylist, setPlaylistUpdateMode/);
  });
});

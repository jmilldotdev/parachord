// src/renderer/lib/save-service-playlist.js: save a service's playlist (a
// recommended playlist on Recommendations, or one opened from there) to the
// person's playlists, without opening it (#1659).
//
// ONE function behind both ways in: the card's right-click "Save to
// Playlists" and the opened playlist's Save. Both are the link import
// (handleImportPlaylistFromUrl, passed in as importFromUrl): it fetches the
// list and saves the record; nothing is resolved until the playlist is viewed
// or played. The cover the card showed rides along as an override, so the
// saved playlist keeps the image the person saw.
//
// It's saved KEPT UPDATED from its link (autoUpdate: true, "Link imports" in
// docs/architecture/sync.md): a recommended playlist is one the service keeps
// changing (a mix, a weekly list), so the saved copy follows it, looked up
// again every hour. Its page's Auto-update switch turns it into a snapshot.
//
// Pure: everything it touches is passed in (`deps`), so jest drives it.
//   deps: { isImported(url), importFromUrl(url, overrides, { autoUpdate }), findSaved(url),
//           openPlaylist(playlist), showToast(message, type, action),
//           errorText(err, fallback) }
// Resolves to 'saved', 'already', 'busy', 'failed', or null (no link).

const inFlight = new Set();

async function saveServicePlaylist({ url, name, coverArt } = {}, deps) {
  if (!url) return null;
  const label = name || 'Playlist';
  const openAction = () => ({
    label: 'Open',
    onClick: () => {
      const saved = deps.findSaved(url);
      if (saved) deps.openPlaylist(saved);
    },
  });
  // Already saved: no fetch (the import would refresh it, which is the
  // playlist page's job), just a way to it.
  if (deps.isImported(url)) {
    deps.showToast(`“${label}” is already in your playlists`, 'info', openAction());
    return 'already';
  }
  // A second click while the first is still saving.
  if (inFlight.has(url)) return 'busy';
  inFlight.add(url);
  try {
    await deps.importFromUrl(url, coverArt ? { coverArt } : null, { autoUpdate: true });
    deps.showToast(`Saved “${label}” to your playlists`, 'success', openAction());
    return 'saved';
  } catch (err) {
    console.error('Saving a service playlist failed:', err);
    deps.showToast(deps.errorText(err, 'Couldn’t save the playlist. Try again.'), 'error');
    return 'failed';
  } finally {
    inFlight.delete(url);
  }
}

module.exports = { saveServicePlaylist };

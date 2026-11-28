// src/renderer/lib/ephemeral-playlist-restore.js: reopening the playlist the
// app was showing when it closed (#1519).
//
// A saved playlist reopens by id. An unsaved (ephemeral) one has to be
// rebuilt, and that used to work for ListenBrainz's weekly playlists only,
// found by `source === 'listenbrainz'`; every other unsaved playlist (an
// Apple Music or Amazon recommended playlist, a history mix) fell back to a
// page after 5 seconds. Now:
//   - a weekly playlist is found by its weekly id (`listenbrainzId`, the
//     field name kept for saved views), whatever plug-in sent it;
//   - any playlist with a link reopens from that link, through the plug-in
//     the registry says owns it (the caller passes its id), never a name.
// Pure: app.js saves the fields, waits for the plug-ins, and loads the record.

// The playlist part of last_active_view.
function lastViewPlaylistFields(playlist, { isHistoryMix = false } = {}) {
  const p = playlist || {};
  const out = { playlistId: p.id, playlistTitle: p.title };
  if (!p.isEphemeral) return out;
  out.isEphemeral = true;
  out.playlistSource = p.source;
  out.isHistoryMix = !!isHistoryMix;
  if (p.listenbrainzId) {
    out.listenbrainzId = p.listenbrainzId;
    out.weekLabel = p.weekLabel;
  }
  if (p.sourceUrl) {
    out.sourceUrl = p.sourceUrl;
    if (p.creator) out.playlistCreator = p.creator;
    if (p.description) out.description = p.description;
    if (p.coverArt) out.coverArt = p.coverArt;
  }
  return out;
}

// How a pending restore is found: 'weekly' (in Home's weekly rows, by id),
// 'link' (rebuilt from its link), 'ephemeral' (unsaved with neither: it
// can't be rebuilt), or 'saved' (in the playlists, by id).
function restoreKind(pending) {
  const p = pending || {};
  if (p.isEphemeral && p.listenbrainzId) return 'weekly';
  if (p.isEphemeral && p.sourceUrl) return 'link';
  if (p.isEphemeral) return 'ephemeral';
  return 'saved';
}

// The ephemeral record a link rebuilds: the playlist the view was showing,
// owned by `resolverId` (the registry's answer for the link). The caller
// adds fetchTracks (the shared recommendation lookup), so its tracks load
// the way they did when it was opened.
function linkRestoreRecord(pending, resolverId) {
  const p = pending || {};
  return {
    id: p.id,
    title: p.title,
    creator: p.creator,
    ...(p.description ? { description: p.description } : {}),
    ...(p.coverArt ? { coverArt: p.coverArt } : {}),
    tracks: [],
    tracksLoaded: false,
    isExternal: true,
    isEphemeral: true,
    source: resolverId,
    sourceUrl: p.sourceUrl,
  };
}

// Where Back goes from the restored playlist: Home for a history mix (it
// lives there), Recommendations for any other unsaved playlist (the weekly
// playlists moved there), the Playlists page for a saved one.
function restoreViewHistory(saved) {
  const s = saved || {};
  if (s.isHistoryMix) return ['home', 'playlist-view'];
  if (s.isEphemeral) return ['library', 'recommendations', 'playlist-view'];
  return ['library', 'playlists', 'playlist-view'];
}

// Where it lands when the playlist can't be found or rebuilt in time.
function restoreFallbackView(pending) {
  const p = pending || {};
  if (p.isHistoryMix) return 'home';
  if (p.isEphemeral) return 'recommendations';
  return 'playlists';
}

module.exports = { lastViewPlaylistFields, restoreKind, linkRestoreRecord, restoreViewHistory, restoreFallbackView };

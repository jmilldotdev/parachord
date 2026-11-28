/**
 * #1519: the last two Last.fm / ListenBrainz id checks.
 *
 * 1. Reopening an unsaved playlist at launch (lib/ephemeral-playlist-restore.js).
 *    It used to be ListenBrainz's weekly playlists only, found by
 *    `source === 'listenbrainz'`. Every other unsaved playlist (an Apple
 *    Music or Amazon recommended playlist, a history mix) fell back to a page
 *    after 5 seconds. Now any plug-in's playlist with a link reopens from that
 *    link, through the plug-in that owns it (the registry, never a name), and
 *    a weekly playlist is found by its weekly id, whatever plug-in sent it.
 * 2. Removing a plug-in (recommendation-model.js cacheWithoutProvider) drops
 *    only ITS cached recommendations, similar listeners and history mixes. It
 *    used to wipe every provider's cached answers, and only for Last.fm and
 *    ListenBrainz.
 */
const fs = require('fs');
const path = require('path');
const R = require('../../src/renderer/lib/ephemeral-playlist-restore');
const { cacheWithoutProvider } = require('../../src/renderer/lib/recommendation-model');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const URL = 'https://music.apple.com/us/playlist/chill-mix/pl.u-abc';

describe('what the last view saves for a playlist', () => {
  test('a saved playlist: its id and title only', () => {
    expect(R.lastViewPlaylistFields({ id: 'p1', title: 'Mine' })).toEqual({ playlistId: 'p1', playlistTitle: 'Mine' });
  });

  test('an unsaved playlist with a link: the link and what the view showed, so it can be rebuilt', () => {
    const fields = R.lastViewPlaylistFields({
      id: 'applemusic-rec-1', title: 'Chill Mix', isEphemeral: true, source: 'applemusic', sourceUrl: URL,
      creator: 'Apple Music', description: 'Recommended by Apple Music', coverArt: 'https://img/c.jpg',
      tracks: [{ title: 't' }], fetchTracks: () => {},
    }, { isHistoryMix: false });
    expect(fields).toEqual({
      playlistId: 'applemusic-rec-1', playlistTitle: 'Chill Mix', isEphemeral: true, playlistSource: 'applemusic', isHistoryMix: false,
      sourceUrl: URL, playlistCreator: 'Apple Music', description: 'Recommended by Apple Music', coverArt: 'https://img/c.jpg',
    });
  });

  test('a weekly playlist: its weekly id, whatever plug-in sent it', () => {
    const fields = R.lastViewPlaylistFields({ id: 'x-wk', title: 'Weekly Jams', isEphemeral: true, source: 'someplugin', listenbrainzId: 'wk1', weekLabel: 'This Week' });
    expect(fields).toMatchObject({ listenbrainzId: 'wk1', weekLabel: 'This Week', playlistSource: 'someplugin' });
  });
});

describe('how a saved last view restores', () => {
  test('the kind: weekly by its weekly id, a link by its link, else a saved playlist', () => {
    expect(R.restoreKind({ isEphemeral: true, source: 'listenbrainz', listenbrainzId: 'wk1' })).toBe('weekly');
    expect(R.restoreKind({ isEphemeral: true, source: 'someplugin', listenbrainzId: 'wk1' })).toBe('weekly');
    expect(R.restoreKind({ isEphemeral: true, source: 'amazonmusic', sourceUrl: URL })).toBe('link');
    expect(R.restoreKind({ isEphemeral: true, isHistoryMix: true, sourceUrl: URL })).toBe('link');
    expect(R.restoreKind({ isEphemeral: true, source: 'listenbrainz' })).toBe('ephemeral');
    expect(R.restoreKind({ id: 'p1' })).toBe('saved');
  });

  test('the record a link rebuilds: the same playlist the view showed, owned by the plug-in the registry names', () => {
    const rec = R.linkRestoreRecord({
      id: 'applemusic-rec-1', title: 'Chill Mix', sourceUrl: URL, creator: 'Apple Music',
      description: 'Recommended by Apple Music', coverArt: 'https://img/c.jpg',
    }, 'applemusic');
    expect(rec).toEqual({
      id: 'applemusic-rec-1', title: 'Chill Mix', creator: 'Apple Music', description: 'Recommended by Apple Music',
      coverArt: 'https://img/c.jpg', tracks: [], tracksLoaded: false, isExternal: true, isEphemeral: true,
      source: 'applemusic', sourceUrl: URL,
    });
    // No cover, no description: none invented.
    const bare = R.linkRestoreRecord({ id: 'x', title: 'X', sourceUrl: URL }, 'applemusic');
    expect(bare.coverArt).toBeUndefined();
    expect(bare.description).toBeUndefined();
  });

  test('where it goes back to, and where it lands if it can\'t be rebuilt', () => {
    expect(R.restoreViewHistory({ isHistoryMix: true, isEphemeral: true })).toEqual(['home', 'playlist-view']);
    expect(R.restoreViewHistory({ isEphemeral: true, sourceUrl: URL })).toEqual(['library', 'recommendations', 'playlist-view']);
    expect(R.restoreViewHistory({ isEphemeral: true, listenbrainzId: 'wk1' })).toEqual(['library', 'recommendations', 'playlist-view']);
    expect(R.restoreViewHistory({ id: 'p1' })).toEqual(['library', 'playlists', 'playlist-view']);
    expect(R.restoreFallbackView({ isHistoryMix: true, isEphemeral: true })).toBe('home');
    expect(R.restoreFallbackView({ isEphemeral: true, sourceUrl: URL })).toBe('recommendations');
    expect(R.restoreFallbackView({ isEphemeral: true, listenbrainzId: 'wk1' })).toBe('recommendations');
    expect(R.restoreFallbackView({ isEphemeral: true })).toBe('recommendations');
    expect(R.restoreFallbackView({ id: 'p1' })).toBe('playlists');
  });
});

describe('removing a plug-in forgets only its own recommendations', () => {
  const cache = {
    providers: { listenbrainz: { sections: [1] }, applemusic: { sections: [2] } },
    similarUsers: { listenbrainz: { users: [] }, lastfm: { users: [] } },
    timestamp: 5,
  };
  test('its providers and similar-users entries go; everyone else\'s stay', () => {
    const next = cacheWithoutProvider(cache, 'listenbrainz');
    expect(next).toEqual({ providers: { applemusic: { sections: [2] } }, similarUsers: { lastfm: { users: [] } }, timestamp: 5 });
    expect(cache.providers.listenbrainz).toBeDefined(); // not mutated
  });
  test('a plug-in with nothing cached changes nothing; a history-mix cache has providers only', () => {
    expect(cacheWithoutProvider(cache, 'spotify')).toBe(cache);
    expect(cacheWithoutProvider({ providers: { a: {}, b: {} } }, 'a')).toEqual({ providers: { b: {} } });
    expect(cacheWithoutProvider(null, 'a')).toBe(null);
  });
});

describe('app.js goes through them, with no name left', () => {
  const app = read('src/renderer/app.js');
  test('the restore', () => {
    expect(app).toContain('Object.assign(viewData, lastViewPlaylistFields(selectedPlaylist, { isHistoryMix }));');
    expect(app).toContain("const kind = restoreKind(pendingPlaylistLoad);");
    expect(app).toContain('const resolverId = resolverLoaderRef.current?.findResolverForUrl(pendingPlaylistLoad.sourceUrl) || null;');
    expect(app).toContain('setViewHistory(restoreViewHistory(savedLastView));');
    expect(app).toContain('const fallback = restoreFallbackView(pendingPlaylistLoad);');
    expect(app).not.toContain("pendingPlaylistLoad.source === 'listenbrainz'");
    expect(app).not.toContain("savedLastView.playlistSource === 'listenbrainz'");
  });
  test('the removal', () => {
    expect(app).toContain('recommendationsCache.current = cacheWithoutProvider(recommendationsCache.current, resolverId);');
    expect(app).toContain('historyMixesCache.current = cacheWithoutProvider(historyMixesCache.current, resolverId);');
    expect(app).not.toContain("if (resolverId === 'lastfm' || resolverId === 'listenbrainz') {");
  });
});

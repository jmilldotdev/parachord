/**
 * Saving a recommended playlist without opening it (#1659). A service's
 * playlist on Recommendations (or one opened from there) is saved through ONE
 * function, `saveServicePlaylist` (lib/save-service-playlist.js): the same
 * link import the opened playlist's Save always ran, so the two can never
 * disagree, and nothing is resolved (the import fetches the list and saves
 * it; tracks resolve when the playlist is viewed or played).
 *
 * The card's way in is its right-click menu ("Save to Playlists", through
 * lib/item-menus.js's playlistMenu and main.js's native menu), so the card's
 * hover set stays the three every playlist card has.
 */
const fs = require('fs');
const path = require('path');
const { saveServicePlaylist } = require('../../src/renderer/lib/save-service-playlist');
const { playlistMenu } = require('../../src/renderer/lib/item-menus');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

const URL = 'https://open.spotify.com/playlist/abc';
const deps = (over = {}) => {
  const saved = [];
  const d = {
    isImported: jest.fn(() => false),
    importFromUrl: jest.fn(async (url) => { saved.push({ id: 'hosted-1', sourceUrl: url, title: 'Chill Mix' }); return { updated: false, playlist: { title: 'Chill Mix' } }; }),
    findSaved: jest.fn((url) => saved.find((p) => p.sourceUrl === url) || null),
    openPlaylist: jest.fn(),
    showToast: jest.fn(),
    errorText: (err, fallback) => fallback,
    ...over,
  };
  return d;
};

describe('saveServicePlaylist', () => {
  test('imports the link once, kept updated, with the cover the card showed, and says so with a way to open it', async () => {
    const d = deps();
    await expect(saveServicePlaylist({ url: URL, name: 'Chill Mix', coverArt: 'https://img/c.jpg' }, d)).resolves.toBe('saved');
    expect(d.importFromUrl).toHaveBeenCalledTimes(1);
    // Kept updated from its link, never a snapshot: the service keeps changing it.
    expect(d.importFromUrl).toHaveBeenCalledWith(URL, { coverArt: 'https://img/c.jpg' }, { autoUpdate: true });
    const [message, type, action] = d.showToast.mock.calls[0];
    expect(message).toBe('Saved “Chill Mix” to your playlists');
    expect(type).toBe('success');
    expect(action.label).toBe('Open');
    action.onClick();
    expect(d.openPlaylist).toHaveBeenCalledWith(expect.objectContaining({ id: 'hosted-1', sourceUrl: URL }));
  });

  test('no cover: no override', async () => {
    const d = deps();
    await saveServicePlaylist({ url: URL, name: 'Chill Mix' }, d);
    expect(d.importFromUrl).toHaveBeenCalledWith(URL, null, { autoUpdate: true });
  });

  test('already saved: nothing is fetched, and the toast opens the saved copy', async () => {
    const existing = { id: 'hosted-9', sourceUrl: URL, title: 'Chill Mix' };
    const d = deps({ isImported: jest.fn(() => true), findSaved: jest.fn(() => existing) });
    await expect(saveServicePlaylist({ url: URL, name: 'Chill Mix' }, d)).resolves.toBe('already');
    expect(d.importFromUrl).not.toHaveBeenCalled();
    const [message, type, action] = d.showToast.mock.calls[0];
    expect(message).toBe('“Chill Mix” is already in your playlists');
    expect(type).toBe('info');
    action.onClick();
    expect(d.openPlaylist).toHaveBeenCalledWith(existing);
  });

  test('a failed import says what to do, never the raw error', async () => {
    const d = deps({ importFromUrl: jest.fn(async () => { throw new Error('HTTP 500 from somewhere'); }) });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(saveServicePlaylist({ url: URL, name: 'Chill Mix' }, d)).resolves.toBe('failed');
    expect(d.showToast).toHaveBeenCalledWith('Couldn’t save the playlist. Try again.', 'error');
    console.error.mockRestore();
  });

  test('no link: nothing happens', async () => {
    const d = deps();
    await expect(saveServicePlaylist({ name: 'X' }, d)).resolves.toBe(null);
    expect(d.importFromUrl).not.toHaveBeenCalled();
    expect(d.showToast).not.toHaveBeenCalled();
  });

  test('two clicks while the first is saving import once', async () => {
    let finish;
    const d = deps({ importFromUrl: jest.fn(() => new Promise((r) => { finish = r; })) });
    const first = saveServicePlaylist({ url: URL, name: 'Chill Mix' }, d);
    await expect(saveServicePlaylist({ url: URL, name: 'Chill Mix' }, d)).resolves.toBe('busy');
    finish({ updated: false });
    await first;
    expect(d.importFromUrl).toHaveBeenCalledTimes(1);
  });
});

describe('the right-click menu', () => {
  test('playlistMenu carries the link to save, the cover, and loading while the tracks are on their way', () => {
    const p = { id: 'spotify-rec-1', title: 'Chill Mix', creator: 'Spotify' };
    expect(playlistMenu(p, [], { isEphemeral: true, saveUrl: URL, coverArt: 'https://img/c.jpg', loading: true }))
      .toMatchObject({ type: 'playlist', isEphemeral: true, saveUrl: URL, coverArt: 'https://img/c.jpg', loading: true });
    expect(playlistMenu(p, [{ title: 't' }], { saveUrl: URL, loading: true }).loading).toBe(false);
    const plain = playlistMenu(p, []);
    expect(plain.saveUrl).toBeUndefined();
    expect(plain.loading).toBeUndefined();
  });

  test('main.js offers Save to Playlists first for a playlist with a link to save, and loading labels while it waits', () => {
    const main = read('main.js');
    expect(main).toMatch(/if \(data\.type === 'playlist' && data\.saveUrl\) \{\s*menuItems\.push\(\{\s*label: 'Save to Playlists'/);
    expect(main).toContain("action: 'save-service-playlist', url: data.saveUrl, name: data.name, coverArt: data.coverArt || null");
    expect(main).toContain("menuLabel = 'Add All to Queue (loading…)'");
  });

  test('the Recommendations playlist card opens it, with the tracks if the hover already fetched them', () => {
    const page = read('src/renderer/components/recommendations-page.js');
    const card = page.slice(page.indexOf('const playlistCard = '), page.indexOf('// ── Weekly playlists'));
    expect(card).toContain('onContextMenu: () => {');
    expect(card).toContain('const cached = cachedServicePlaylistTracks(item);');
    expect(card).toContain('if (!cached) prefetchRecommendationPlaylist(item);');
    expect(card).toContain('window.showItemMenu(playlistMenu(');
    expect(card).toContain('saveUrl: item.url');
  });

  test('app.js: the menu action, and the opened playlist\'s Save, run the same save', () => {
    const app = read('src/renderer/app.js');
    expect(app).toContain("} else if (data.action === 'save-service-playlist' && data.url) {");
    expect(app).toContain('saveServicePlaylistRef.current({ url: data.url, name: data.name, coverArt: data.coverArt });');
    const view = read('src/renderer/components/playlist-view-page.js');
    expect(view).toContain('await saveServicePlaylist({ url: selectedPlaylist.sourceUrl, name: selectedPlaylist.title, coverArt: selectedPlaylist.coverArt || null });');
    expect(view).not.toContain('await handleImportPlaylistFromUrl(\n                      selectedPlaylist.sourceUrl');
  });
});

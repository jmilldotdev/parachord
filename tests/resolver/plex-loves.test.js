/**
 * Plex likes as loves (parachord#1559 step 7). Plex has no like of its own:
 * Plexamp's like is a 5-star rating, stored as userRating 10 (the 0-10
 * scale), written with PUT /:/rate (python-plexapi's rate()). So:
 *   - a heart rates the track 10 on its server, whatever it was rated before
 *     (a love is a like), found there first by the host (needs: 'serviceId');
 *   - Import lists the tracks rated 10 in the chosen libraries, newest rating
 *     first, each carrying its Plex source (never the token);
 *   - Parachord never clears or lowers a rating.
 * Built from the research without a live server (2026-11-28): the rated-
 * tracks filter is asked for, and every row is checked again here, so a
 * server that ignores or refuses the filter still answers only 5 stars.
 *
 * The implementation runs with a fake window.electron.plex.fetch; the
 * manifest and the host's wrapper run through the real loader.
 */

const fs = require('fs');
const path = require('path');
const plex = require('../../plugins-src/plex/implementation');
const ResolverLoader = require('../../resolver-loader');
const LP = require('../../src/renderer/lib/love-providers');

const ROOT = path.join(__dirname, '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins-src/plex/manifest.json'), 'utf8'));

const BASE = 'http://192.168.1.5:32400';
const LIB = { serverId: 'srv1', serverName: 'Attic', accessToken: 'TOKEN-1', connections: [BASE], key: '3', title: 'Music' };
const CONFIG = { authToken: 'ACCOUNT', clientId: 'parachord-x', libraries: [LIB] };

const meta = (ratingKey, over = {}) => ({
  ratingKey, title: `Song ${ratingKey}`, grandparentTitle: 'Radiohead', parentTitle: 'Kid A',
  duration: 200000, thumb: `/library/metadata/${ratingKey}/thumb/1`,
  Media: [{ Part: [{ key: `/library/parts/${ratingKey}/file.flac` }] }],
  ...over,
});

// A fake plex.fetch: `route(url, options)` answers each request (or null for
// a 404). Every call is recorded.
function installFetch(route) {
  const calls = [];
  global.window = {
    electron: {
      plex: {
        fetch: async (url, options = {}) => {
          calls.push({ url, method: options.method || 'GET' });
          if (url.includes('/identity')) return { ok: true, status: 200, text: '{}' };
          const answer = route(url, options);
          if (!answer) return { ok: false, status: 404, text: '' };
          if (answer.status && answer.status !== 200) return { ok: false, status: answer.status, text: '' };
          return { ok: true, status: 200, text: JSON.stringify(answer.body === undefined ? answer : answer.body) };
        },
      },
    },
  };
  return calls;
}

const container = (Metadata, totalSize = Metadata.length) => ({ MediaContainer: { Metadata, size: Metadata.length, totalSize } });

afterEach(() => { delete global.window; });

describe('the manifest', () => {
  test('declares likes, by the track on the server, with import', () => {
    expect(manifest.capabilities.lovedTracks).toBe(true);
    expect(LP.loveDescriptor(manifest.loves)).toEqual({ contract: 1, verb: 'Like', needs: 'serviceId', canImport: true });
    expect(LP.loveWords('Like')).toMatchObject({ plural: 'likes', past: 'liked', tracksNoun: 'liked tracks' });
  });
});

describe('loveTrack', () => {
  const track = (source) => ({ artist: 'Radiohead', title: 'Song 42', sources: source ? { plex: source } : {} });

  test('rates the track 10 (5 stars) on its server, with the saved token', async () => {
    const calls = installFetch((url, o) => (url.includes('/:/rate') && o.method === 'PUT' ? {} : null));
    await expect(plex.loveTrack(track({ plexRatingKey: '42', plexServerId: 'srv1' }), CONFIG)).resolves.toEqual({ ok: true, ref: '42' });
    const rate = calls.find((c) => c.url.includes('/:/rate'));
    expect(rate.method).toBe('PUT');
    expect(rate.url).toBe(`${BASE}/:/rate?key=42&identifier=com.plexapp.plugins.library&rating=10&X-Plex-Token=TOKEN-1`);
  });

  test('never anything but 10: no lower rating, no clear', () => {
    const src = fs.readFileSync(path.join(ROOT, 'plugins-src/plex/implementation.js'), 'utf8');
    const rates = src.match(/\/:\/rate\?[^'"]*/g) || [];
    expect(rates.length).toBe(1);
    expect(src).toContain("'&identifier=com.plexapp.plugins.library&rating=10'");
    expect(src).not.toMatch(/rating=-1|rating=0\b/);
  });

  test('no Plex source, or one from a server it no longer knows, is no match', async () => {
    installFetch(() => ({}));
    await expect(plex.loveTrack(track(null), CONFIG)).resolves.toEqual({ ok: false, reason: 'no-match' });
    await expect(plex.loveTrack(track({ plexServerId: 'srv1' }), CONFIG)).resolves.toEqual({ ok: false, reason: 'no-match' });
    await expect(plex.loveTrack(track({ plexRatingKey: '42', plexServerId: 'gone' }), { libraries: [LIB] })).resolves.toEqual({ ok: false, reason: 'no-match' });
  });

  test('a refused or failed write throws, so the push retries it', async () => {
    installFetch((url) => (url.includes('/:/rate') ? { status: 401 } : null));
    await expect(plex.loveTrack(track({ plexRatingKey: '42', plexServerId: 'srv1' }), CONFIG)).rejects.toThrow('HTTP 401');
  });
});

describe('getLovedPage', () => {
  test('the 5-star tracks of every chosen library, newest rating first, each with its source and no token', async () => {
    const lib2 = { ...LIB, key: '7', title: 'Vinyl rips' };
    const calls = installFetch((url) => {
      if (url.includes('/library/sections/3/all')) {
        return container([
          meta('1', { userRating: 10, lastRatedAt: 1700000000 }),
          meta('2', { userRating: 10, lastRatedAt: 1700000500, Guid: [{ id: 'mbid://2c6cf4f6-1a4f-4b8b-9b67-4c6c6a2f1c11' }] }),
        ]);
      }
      if (url.includes('/library/sections/7/all')) return container([meta('9', { userRating: 10 })]);
      return null;
    });
    const page = await plex.getLovedPage({ cursor: null }, { ...CONFIG, libraries: [LIB, lib2] });
    expect(page.next).toBeNull();
    expect(page.items.map((i) => i.title)).toEqual(['Song 2', 'Song 1', 'Song 9']);
    expect(page.items[0]).toMatchObject({ artist: 'Radiohead', album: 'Kid A', lovedAt: 1700000500, mbid: '2c6cf4f6-1a4f-4b8b-9b67-4c6c6a2f1c11' });
    expect(page.items[2].lovedAt).toBeNull();
    expect(page.items[0].source).toMatchObject({ id: 'plex-srv1-2', plexRatingKey: '2', plexServerId: 'srv1', plexPartKey: '/library/parts/2/file.flac' });
    for (const item of page.items) expect(JSON.stringify(item)).not.toContain('TOKEN-1');
    // It asks the server for the 5-star tracks only.
    const list = calls.find((c) => c.url.includes('/library/sections/3/all'));
    expect(list.url).toContain('type=10');
    expect(list.url).toContain('userRating%3E%3E=9');
  });

  test('a server that ignores the filter still gives only 5-star tracks', async () => {
    installFetch((url) => (url.includes('/all') ? container([
      meta('1', { userRating: 10 }), meta('2', { userRating: 8 }), meta('3', { userRating: 9 }), meta('4'),
    ]) : null));
    const page = await plex.getLovedPage({ cursor: null }, CONFIG);
    expect(page.items.map((i) => i.title)).toEqual(['Song 1']);
  });

  test('a server that refuses the filter is asked again without it', async () => {
    const calls = installFetch((url) => {
      if (!url.includes('/all')) return null;
      if (url.includes('userRating')) return { status: 400 };
      return container([meta('1', { userRating: 10 }), meta('2')]);
    });
    const page = await plex.getLovedPage({ cursor: null }, CONFIG);
    expect(page.items.map((i) => i.title)).toEqual(['Song 1']);
    expect(calls.filter((c) => c.url.includes('/all')).length).toBe(2);
  });

  test('pages through a big library', async () => {
    installFetch((url) => {
      if (!url.includes('/all')) return null;
      const start = Number(/X-Plex-Container-Start=(\d+)/.exec(url)[1]);
      const rows = start === 0
        ? Array.from({ length: 1000 }, (_, i) => meta(String(i), { userRating: 10 }))
        : [meta('1000', { userRating: 10 })];
      return container(rows, 1001);
    });
    const page = await plex.getLovedPage({ cursor: null }, CONFIG);
    expect(page.items.length).toBe(1001);
  });

  test('an unreachable server or a failed list throws, never an empty list', async () => {
    installFetch((url) => (url.includes('/all') ? { status: 500 } : null));
    await expect(plex.getLovedPage({ cursor: null }, CONFIG)).rejects.toThrow('HTTP 500');
    await expect(plex.getLovedPage({ cursor: null }, {})).rejects.toThrow();
  });
});

describe('through the host', () => {
  let resolver;
  beforeAll(async () => {
    const axe = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/plex.axe'), 'utf8'));
    const loader = new ResolverLoader();
    await loader.loadResolvers([axe]);
    resolver = loader.getResolver('plex');
  });

  test('the built plug-in is a love provider with import; set up means signed in', async () => {
    expect(resolver.loves).toEqual(manifest.loves);
    expect(LP.lovesOf(resolver)).toMatchObject({ verb: 'Like', canImport: true });
    const signedOut = LP.loveProviderFor(resolver, { getConfig: async () => ({}) });
    await expect(signedOut.isSignedIn()).resolves.toBe(false);
    const signedIn = LP.loveProviderFor(resolver, { getConfig: async () => CONFIG });
    await expect(signedIn.isSignedIn()).resolves.toBe(true);
    expect(typeof signedIn.getLovedPage).toBe('function');
  });

  test('its Settings rows', () => {
    expect(LP.loveRowState(resolver, { name: 'Plex', pluginConfig: {} })).toMatchObject({ signedIn: false, signedOutHint: 'Set up Plex first' });
    expect(LP.loveRowState(resolver, { name: 'Plex', pluginConfig: CONFIG })).toMatchObject({ signedIn: true, importReady: true });
  });
});

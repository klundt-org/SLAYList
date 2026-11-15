// Copyright (c) 2026 Ray Klundt
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The barebones "all songs" list (Sprint 4.3) — reads real metadata from the API and shows
 * title / owner / genre / state. No audio, no player yet (Epic 8). Deactivated records are already
 * filtered out server-side (D45), so this just renders the list it's given.
 *
 * This is intentionally plain: the real mobile-first layout + player UI are Epic 8.
 */

import { useSongs } from './useSongs.js';

export function SongList() {
  const state = useSongs();

  if (state.status === 'loading') return <p>Loading songs…</p>;
  if (state.status === 'error') return <p>Couldn’t load songs just now. Try refreshing the page.</p>;
  if (state.songs.length === 0) return <p>No songs yet.</p>;

  return (
    <table className="song-list">
      <thead>
        <tr>
          <th>Title</th>
          <th>Owner</th>
          <th>Genre</th>
          <th>State</th>
        </tr>
      </thead>
      <tbody>
        {state.songs.map((song) => (
          <tr key={song.id}>
            <td>{song.title}</td>
            <td>{song.ownerDisplayName}</td>
            <td>{song.genre ?? '—'}</td>
            <td>
              <span className={`state state-${song.state}`}>{song.state}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

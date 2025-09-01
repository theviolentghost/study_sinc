import { Routes } from '@angular/router';

import { SearchComponent } from '../search/search.component';
import { PlaylistsComponent } from '../playlists/playlists.component';
import { ArtistsComponent } from '../artists/artists.component';
import { SettingsComponent } from '../settings/settings.component';
import { DiscoverComponent } from '../discover/discover.component';
import { PlaylistComponent } from '../playlist/playlist.component';

import { ArtistComponent } from '../artist/artist.component';
import { TrackComponent } from '../track/track.component';
import  { AlbumComponent } from '../album/album.component';


export const routes: Routes = [
    {
        path: '',
        redirectTo: 'playlists',
        pathMatch: 'full',
    },
    // { path: '**', redirectTo: 'playlists' },
    {
        path: 'searches',
        component: SearchComponent,
    },
    {
        path: 'playlists',
        component: PlaylistsComponent,
    },
    {
        path: 'playlist/:playlist_id',
        component: PlaylistComponent,
    },
    {
        path: 'artists',
        component: ArtistsComponent,
    },
    {
        path: 'artist/:artist_id',
        component: ArtistComponent,
    },
    {
        path: 'track/:track_id',
        component: TrackComponent,
    },
    {
        path: 'album/:album_id',
        component: AlbumComponent,
    },
    {
        path: 'discover',
        component: DiscoverComponent,
    },
    {
        path: 'settings',
        component: SettingsComponent,
    }
];

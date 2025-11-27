import { AfterViewInit, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MusicMediaService, Song_Data, Song_Identifier, Song_Playlist, Song_Playlist_Identifier } from '../../music.media.service';
import { PlaylistsService } from '../../playlists.service';
import { HotActionService } from '../../hot.action.service';
import { MusicPlayerService } from '../../music.player.service';
import { LoadingService } from '../app/services/loading.service';

@Component({
  selector: 'app-playlists',
  imports: [CommonModule],
  templateUrl: './playlists.component.html',
  styleUrl: './playlists.component.css'
})
export class PlaylistsComponent implements OnInit {
    ngOnInit(): void {
        this.loading_service.loading = false;
    }
    // ngAfterViewInit(): void {
    //     this.loading_service.loading = false;
    // }

    constructor(private media: MusicMediaService, private playlists: PlaylistsService, private hot_action: HotActionService, private player: MusicPlayerService, private loading_service: LoadingService) {}

    get playlist_identifiers(): Song_Playlist_Identifier[] {
        return this.playlists.playlist_identifiers;
    }

    get default_playlist_identifiers(): Song_Playlist_Identifier[] {
        // console.log('Default playlist identifiers:', this.playlists.default_playlist_identifiers);
        return this.playlists.default_playlist_identifiers;
    }

    is_current_playlist_this_playlist(playlist: Song_Playlist_Identifier): boolean {
        return this.player.playlist_identifier?.id === playlist.id;
    }

    select_playlist(playlist: Song_Playlist_Identifier): void {
        this.playlists.select_playlist(playlist);
    }

    create_playlist(): void {
        this.hot_action.open_hot_action(null, 'youtube', 'create_playlist');
    }
    import_playlist(): void {
        this.hot_action.open_hot_action(null, 'youtube', 'import_playlist');
    }

    ms_to_time(ms: number): string {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    get_playlist_primary_color(playlist_identifier: Song_Playlist_Identifier): string {
        return playlist_identifier?.colors?.primary || 'var(--color-primary)';
    }

    start_dj_play(): void {

    }
}

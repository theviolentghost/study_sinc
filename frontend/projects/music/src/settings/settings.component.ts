import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { MusicPlayerService } from '../../music.player.service';

interface Setting_Genre {
    label: string;
}

@Component({
  selector: 'app-settings',
  imports: [FormsModule, CommonModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css'
})
export class SettingsComponent {
    genres: Setting_Genre[] = [
        { label: 'Account' },
        { label: 'Playback' },
        { label: 'Media quality' },
        { label: 'Appearance' },
        { label: 'About' },
    ];


    get is_silent_audio_allowed(): boolean {
        // return this.player.is_silent_audio_allowed;
        return true;
    }

    get use_silent_audio(): boolean {
        // return this.player.use_silent_audio;
        return true;
    }

    set use_silent_audio(value: boolean) {
        // this.player.use_silent_audio = value;
    }

    constructor(private player: MusicPlayerService) {}

    public open_genre_setting(genre: Setting_Genre): void {

    }
}

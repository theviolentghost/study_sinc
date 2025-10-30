import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MusicPlayerService } from '../../music.player.service';

@Component({
  selector: 'app-settings',
  imports: [FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css'
})
export class SettingsComponent {
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
}

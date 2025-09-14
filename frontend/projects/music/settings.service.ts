import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
    private _prefers_shuffle_play_over_dj_play: boolean = true;

    get prefers_shuffle_play_over_dj_play(): boolean {
        return this._prefers_shuffle_play_over_dj_play;
    }

    set prefers_shuffle_play_over_dj_play(value: boolean) {
        this._prefers_shuffle_play_over_dj_play = value;
    }

    constructor() { }
}

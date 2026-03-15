import { Injectable } from '@angular/core';

export interface Setting_Genre {
    label: string;
}

// New types for settings
export type Setting_Type = 'toggle' | 'dropdown' | 'info';

export interface Setting_Option {
    label: string;
    value: any;
}

export interface Setting_Note {
    text: string;
    severity: 'info' | 'warning';
}

export interface Setting {
    id: string;
    label: string;
    type: Setting_Type;
    // current value for toggle/dropdown
    hidden?: boolean; // for info type
    value?: any;
    default?: any; // default value
    // for dropdowns
    options?: Setting_Option[];
    // Optional dependency: this setting is enabled only when the referenced setting has this value
    depends_on?: { id: string; value: any };
    // Optional notes - can be a single note object or array of notes
    notes?: Setting_Note | Setting_Note[];
    // Optional callback function: for toggles receives (value: boolean), for dropdowns receives (index: number, value: any)
    on_change?: (self: any, valueOrIndex: any, value?: any) => void;
}

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
    private _prefers_shuffle_play_over_dj_play: boolean = true;
    public _is_safari: boolean = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    public is_safari: boolean = this._is_safari; // togglable, used for safari workaround
    public shuffle_playback: boolean = false; 
    public repeat_playback: boolean = false;
    public closed_captioning: boolean = false;
    
    // DJ Mode settings
    public dj_mode_enabled: boolean = false;
    public dj_mix_style: 'quick' | 'balanced' | 'extended' | 'long' = 'balanced';
    public dj_auto_transition: boolean = true; // Auto-trigger DJ transition when approaching end of song

    public app_theme_dependence: 'app' | 'playlist' | 'song' = 'app';

    public genre_settings: Record<string, Setting[]> = {};

    get prefers_shuffle_play_over_dj_play(): boolean {
        return this._prefers_shuffle_play_over_dj_play;
    }

    set prefers_shuffle_play_over_dj_play(value: boolean) {
        this._prefers_shuffle_play_over_dj_play = value;
    }

    constructor() {
        this.genre_settings = {
            Playback: [
                { 
                    id: 'is_safari', 
                    label: 'Using Safari as browser', 
                    type: 'toggle', 
                    value: this.is_safari, // default
                    notes: [
                        { text: 'Useful for bypassing Safari web playing restrictions', severity: 'info' },
                        { text: 'Setting is experimental. Avoid changing. \nOn change, reload the app to apply.', severity: 'warning' }
                    ],
                    on_change: (self, value: boolean) => {
                        this.is_safari = value;
                        this.save_settings_to_local_storage();
                    }
                },
                {
                    id: 'shuffle_play',
                    label: 'Enable Shuffle Play',
                    type: 'toggle',
                    hidden: true,
                    value: null,
                    notes: [
                        { text: 'When enabled, tracks will be played in random order.', severity: 'info' }
                    ],
                    on_change: (self, value: boolean) => {
                        this.shuffle_playback = value;
                        this.save_settings_to_local_storage();
                    }
                },
                {
                    id: 'repeat_play',
                    label: 'Enable Repeat Play',
                    type: 'toggle',
                    hidden: true,
                    value: null, 
                    notes: [
                        { text: 'When enabled, tracks will be played in a loop.', severity: 'info' }
                    ],
                    on_change: (self, value: boolean) => {
                        this.repeat_playback = value;
                        this.save_settings_to_local_storage();
                    }
                },
                {
                    id: 'dj_mode_enabled',
                    label: 'Enable DJ Mode',
                    type: 'toggle',
                    value: null,
                    default: false,
                    notes: [
                        { text: 'When enabled, songs will blend seamlessly into each other using AI-powered DJ mixing.', severity: 'info' }
                    ],
                    on_change: (self, value: boolean) => {
                        this.dj_mode_enabled = value;
                        this.save_settings_to_local_storage();
                    }
                },
                {
                    id: 'dj_mix_style',
                    label: 'DJ Mix Style',
                    type: 'dropdown',
                    value: null,
                    default: 'balanced',
                    options: [
                        { label: 'Quick (3-5s)', value: 'quick' },
                        { label: 'Balanced (6-10s)', value: 'balanced' },
                        { label: 'Extended (10-16s)', value: 'extended' },
                        { label: 'Long (16-24s)', value: 'long' }
                    ],
                    depends_on: { id: 'dj_mode_enabled', value: true },
                    notes: [
                        { text: 'Controls how long the crossfade between songs lasts.', severity: 'info' }
                    ],
                    on_change: (self, index: number, value: any) => {
                        this.dj_mix_style = value;
                        this.save_settings_to_local_storage();
                    }
                },
                {
                    id: 'dj_auto_transition',
                    label: 'Auto DJ Transitions',
                    type: 'toggle',
                    value: null,
                    default: true,
                    depends_on: { id: 'dj_mode_enabled', value: true },
                    notes: [
                        { text: 'Automatically prepare and play DJ mixes when approaching end of current song.', severity: 'info' }
                    ],
                    on_change: (self, value: boolean) => {
                        this.dj_auto_transition = value;
                        this.save_settings_to_local_storage();
                    }
                },
            ],
            'Media quality': [
                
            ],
            Appearance: [
                {
                    id: 'app_theme_dependence',
                    label: 'App Theme Dependence',
                    type: 'dropdown',
                    options: [
                        { label: 'App Theme', value: 'app' },
                        { label: 'Playlist Theme', value: 'playlist' },
                        { label: 'Song Theme', value: 'song' }

                    ],
                    value: null,
                    default: 'app',
                    notes: [
                        { text: 'Will set the app\'s theme based on the selected option.', severity: 'info' }
                    ],
                    on_change: (self, index: number, value: 'app' | 'playlist' | 'song') => {
                        this.app_theme_dependence = value;
                        console.log('App theme dependence set to:', value, self);
                        self.value = value;
                        this.save_settings_to_local_storage();
                    }
                },
                {
                    id: 'app_default_theme',
                    label: 'App Theme',
                    type: 'dropdown',
                    options: [
                        { label: 'Red', value: 'red' },
                        { label: 'Orange', value: 'orange' },
                        { label: 'Yellow', value: 'yellow' },
                        { label: 'Green', value: 'green' },
                        { label: 'Blue', value: 'blue' },
                        { label: 'Purple', value: 'purple' },
                    ],
                    value: null,
                    default: 'orange',
                    notes: [],
                    on_change: (self, index: number, value: any) => {
                        // Implement theme change logic here
                        this.save_settings_to_local_storage();
                    }
                },
                {
                    id: 'closed_captioning',
                    label: 'Enable Closed Captioning',
                    type: 'toggle',
                    hidden: true,
                    value: null, 
                    notes: [
                        { text: 'When enabled, lyrics will be displayed as subtitles.', severity: 'info' }
                    ],
                    on_change: (self, value: boolean) => {
                        this.closed_captioning = value;
                        this.save_settings_to_local_storage();
                    }
                },
            ],
            About: [
                
            ]
        };

        this.load_settings_from_local_storage();
    }

    private save_settings_to_local_storage(): void {
        // loop through all genres and their settings and save their values to their ids
        for (const [genre, settings] of Object.entries(this.genre_settings)) {
            for (const setting of settings) {
                if (setting.value !== null) localStorage.setItem(setting.id, JSON.stringify(setting.value));
            }
        }
    }

    private load_settings_from_local_storage(): void {
        // loop through all genres and their settings and load their values from local storage if available
        for (const [genre, settings] of Object.entries(this.genre_settings)) {
            for (const setting of settings) {
                const storedValue = localStorage.getItem(setting.id);
                if (storedValue !== null) {
                    const parsedValue = JSON.parse(storedValue);
                    setting.value = parsedValue;
                    
                    // Call the onChange handler to update the service/state
                    if (setting.on_change) {
                        if (setting.type === 'dropdown' && setting.options) {
                            // For dropdown: find the index of the stored value
                            const index = setting.options.findIndex(o => o.value === parsedValue);
                            if (index !== -1) {
                                setting.on_change(setting, index, parsedValue);
                            }
                        } else if (setting.type === 'toggle') {
                            // For toggle: call with the boolean value
                            setting.on_change(setting, parsedValue);
                        }
                    }
                }
                // if value is still null, use the default (which is already set in the initial definition)
            }
        }
    }

    public set_setting_value(setting_id: string, value: any): void {
        for (const settings of Object.values(this.genre_settings)) {
            const setting = settings.find(s => s.id === setting_id);
            if (setting) {
                setting.value = value;
                // Call on_change if exists
                if (setting.on_change) {
                    if (setting.type === 'dropdown' && setting.options) {
                        const index = setting.options.findIndex(o => o.value === value);
                        if (index !== -1) {
                            setting.on_change(setting, index, value);
                        }
                    } else if (setting.type === 'toggle') {
                        setting.on_change(setting, value);
                    }
                }
                this.save_settings_to_local_storage();
                break;
            }
        }
    }
}

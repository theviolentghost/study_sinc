import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { MusicPlayerService } from '../../music.player.service';
import { SettingsService } from '../../settings.service';

export interface Setting_Genre {
    label: string;
}

// New types for settings
export type SettingType = 'toggle' | 'dropdown' | 'info';

export interface SettingOption {
    label: string;
    value: any;
}

export interface SettingNote {
    text: string;
    severity: 'info' | 'warning';
}

export interface Setting {
    id: string;
    label: string;
    type: SettingType;
    // current value for toggle/dropdown
    value?: any;
    // for dropdowns
    options?: SettingOption[];
    // Optional dependency: this setting is enabled only when the referenced setting has this value
    dependsOn?: { id: string; value: any };
    // Optional notes - can be a single note object or array of notes
    notes?: SettingNote | SettingNote[];
    // Optional callback function: for toggles receives (value: boolean), for dropdowns receives (index: number, value: any)
    onChange?: (valueOrIndex: any, value?: any) => void;
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

    // New: mapping of genre label -> settings
    public genre_settings: Record<string, Setting[]> = {};

    // UI state
    public selectedGenre: string | null = null;
    // Track which dropdown settings are expanded
    public expandedDropdowns: Set<string> = new Set();

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

    constructor(private player: MusicPlayerService, private settings_service: SettingsService) {
        // Initialize genreSettings after services are available
        this.genre_settings = {
            Playback: [
                { 
                    id: 'is_safari', 
                    label: 'Using Safari as browser', 
                    type: 'toggle', 
                    value: this.settings_service.is_safari, // default
                    notes: [
                        { text: 'Useful for bypassing Safari web playing restrictions', severity: 'info' },
                        { text: 'Setting is experimental. Avoid changing.', severity: 'warning' }
                    ],
                    onChange: (value: boolean) => {
                        this.settings_service.is_safari = value;
                        this.save_settings_to_local_storage();
                    }
                },
                // { 
                //     id: 'silent_quality', 
                //     label: 'Silent audio quality', 
                //     type: 'dropdown', 
                //     value: '32k', 
                //     options: [
                //         { label: '32 kbps (recommended)', value: '32k' },
                //         { label: '64 kbps', value: '64k' }
                //     ], 
                //     dependsOn: { id: 'use_silent_audio', value: true },
                //     onChange: (index: number, value: string) => {
                //         console.log('Silent quality changed - Index:', index, 'Value:', value);
                //     }
                // },
                // { 
                //     id: 'gapless', 
                //     label: 'Gapless playback', 
                //     type: 'toggle', 
                //     value: false, 
                //     notes: { text: 'May increase CPU usage', severity: 'warning' },
                //     onChange: (value: boolean) => {
                //         console.log('Gapless playback toggled:', value);
                //     }
                // },
            ],
            'Media quality': [
                // { 
                //     id: 'stream_quality', 
                //     label: 'Streaming quality', 
                //     type: 'dropdown', 
                //     value: 'auto', 
                //     options: [
                //         { label: 'Auto', value: 'auto' },
                //         { label: 'High', value: 'high' },
                //         { label: 'Low (data saver)', value: 'low' }
                //     ] 
                // },
                // { 
                //     id: 'hq_on_cellular', 
                //     label: 'Allow high quality on cellular', 
                //     type: 'toggle', 
                //     value: false, 
                //     notes: { text: 'May use significant data on mobile networks', severity: 'warning' }
                // }
            ],
            Appearance: [
                // { 
                //     id: 'theme', 
                //     label: 'Theme', 
                //     type: 'dropdown', 
                //     value: 'system', 
                //     options: [
                //         { label: 'System', value: 'system' },
                //         { label: 'Light', value: 'light' },
                //         { label: 'Dark', value: 'dark' }
                //     ] 
                // },
                // { 
                //     id: 'compact_mode', 
                //     label: 'Compact UI', 
                //     type: 'toggle', 
                //     value: false 
                // }
            ],
            About: [
                // { 
                //     id: 'version', 
                //     label: 'App version', 
                //     type: 'info', 
                //     value: '1.0.0' 
                // }
            ]
        };

        this.load_settings_from_local_storage();
    }

    private save_settings_to_local_storage(): void {
        // loop through all genres and their settings and save their values to their ids
        for (const [genre, settings] of Object.entries(this.genre_settings)) {
            for (const setting of settings) {
                localStorage.setItem(setting.id, JSON.stringify(setting.value));
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
                    if (setting.onChange) {
                        if (setting.type === 'dropdown' && setting.options) {
                            // For dropdown: find the index of the stored value
                            const index = setting.options.findIndex(o => o.value === parsedValue);
                            if (index !== -1) {
                                setting.onChange(index, parsedValue);
                            }
                        } else if (setting.type === 'toggle') {
                            // For toggle: call with the boolean value
                            setting.onChange(parsedValue);
                        }
                    }
                }
                // if value is still null, use the default (which is already set in the initial definition)
            }
        }
    }






    // Open a genre and show its specific settings
    public open_genre_setting(genre: Setting_Genre): void {
        this.selectedGenre = genre.label;
    }

    // Go back to genre list
    public back_to_genres(): void {
        this.selectedGenre = null;
    }

    // Helper: get settings for current genre
    public get currentSettings(): Setting[] {
        if (!this.selectedGenre) return [];
        return this.genre_settings[this.selectedGenre] || [];
    }

    // Check whether a setting should be disabled because of dependency
    public isSettingDisabled(s: Setting): boolean {
        if (!s.dependsOn) return false;
        const all = this.currentSettings.reduce((map, st) => {
            map[st.id] = st;
            return map;
        }, {} as Record<string, Setting>);
        const dep = all[s.dependsOn.id];
        if (!dep) return false;
        return dep.value !== s.dependsOn.value;
    }

    // When user changes a setting value
    public onSettingChange(s: Setting, newValue: any, optionIndex?: number): void {
        s.value = newValue;
        
        // Call custom onChange handler if provided
        if (s.onChange) {
            if (s.type === 'dropdown' && optionIndex !== undefined) {
                // For dropdown: pass (index, value)
                s.onChange(optionIndex, newValue);
            } else if (s.type === 'toggle') {
                // For toggle: pass (value)
                s.onChange(newValue);
            }
        }
        
        // Potential hook: persist settings to MusicPlayerService or backend
        // Example: if silent audio toggle changed, update player
        if (s.id === 'use_silent_audio') {
            // this.player.use_silent_audio = !!newValue;
        }
    }

    // Toggle dropdown expansion
    public toggleDropdown(settingId: string): void {
        if (this.expandedDropdowns.has(settingId)) {
            this.expandedDropdowns.delete(settingId);
        } else {
            this.expandedDropdowns.add(settingId);
        }
    }

    // Check if dropdown is expanded
    public isDropdownExpanded(settingId: string): boolean {
        return this.expandedDropdowns.has(settingId);
    }

    // Select an option from custom dropdown
    public selectDropdownOption(s: Setting, option: SettingOption, index: number): void {
        this.onSettingChange(s, option.value, index);
        this.expandedDropdowns.delete(s.id); // Collapse after selection
    }

    // Helper: Get the display label for a dropdown's current value
    public getDropdownLabel(s: Setting): string {
        if (s.type !== 'dropdown' || !s.options) return 'Select...';
        const selected = s.options.find(o => o.value === s.value);
        return selected?.label || 'Select...';
    }

    // Helper: Get notes as an array (handles both single note and array of notes)
    public getSettingNotes(s: Setting): SettingNote[] {
        if (!s.notes) return [];
        return Array.isArray(s.notes) ? s.notes : [s.notes];
    }
}

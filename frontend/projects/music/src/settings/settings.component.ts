import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { MusicPlayerService } from '../../music.player.service';
import { SettingsService, Setting_Genre, Setting, Setting_Type, Setting_Option, Setting_Note } from '../../settings.service';

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
        

        // this.load_settings_from_local_storage();
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
        return this.settings_service.genre_settings[this.selectedGenre] || [];
    }

    // Check whether a setting should be disabled because of dependency
    public isSettingDisabled(s: Setting): boolean {
        if (!s.depends_on) return false;
        const all = this.currentSettings.reduce((map, st) => {
            map[st.id] = st;
            return map;
        }, {} as Record<string, Setting>);
        const dep = all[s.depends_on.id];
        if (!dep) return false;
        return dep.value !== s.depends_on.value;
    }

    // When user changes a setting value
    public onSettingChange(s: Setting, newValue: any, optionIndex?: number): void {
        s.value = newValue;
        
        // Call custom onChange handler if provided
        if (s.on_change) {
            if (s.type === 'dropdown' && optionIndex !== undefined) {
                // For dropdown: pass (index, value)
                s.on_change(s, optionIndex, newValue);
            } else if (s.type === 'toggle') {
                // For toggle: pass (value)
                s.on_change(s, newValue);
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
    public selectDropdownOption(s: Setting, option: Setting_Option, index: number): void {
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
    public getSettingNotes(s: Setting): Setting_Note[] {
        if (!s.notes) return [];
        return Array.isArray(s.notes) ? s.notes : [s.notes];
    }

    /**
     * Public method to programmatically update a setting from external components
     * @param settingId - The ID of the setting to update
     * @param newValue - The new value for the setting
     * @param optionIndex - Optional: for dropdown settings, the index of the selected option
     * @returns true if setting was found and updated, false otherwise
     */
    public update_setting(settingId: string, newValue: any, optionIndex?: number): boolean {
        // Search through all genres to find the setting
        for (const [genre, settings] of Object.entries(this.settings_service.genre_settings)) {
            const setting = settings.find(s => s.id === settingId);
            if (setting) {
                // Don't update if setting is disabled due to dependencies
                if (this.isSettingDisabled(setting)) {
                    console.warn(`Setting ${settingId} is disabled due to dependency and cannot be updated`);
                    return false;
                }
                
                // Update the setting
                this.onSettingChange(setting, newValue, optionIndex);
                return true;
            }
        }
        
        console.warn(`Setting with id ${settingId} not found`);
        return false;
    }

    /**
     * Public method to get the current value of a setting
     * @param settingId - The ID of the setting to retrieve
     * @returns The current value of the setting, or undefined if not found
     */
    public getSetting(settingId: string): any {
        for (const [genre, settings] of Object.entries(this.settings_service.genre_settings)) {
            const setting = settings.find(s => s.id === settingId);
            if (setting) {
                return setting.value;
            }
        }
        return undefined;
    }

    /**
     * Public method to get a setting object by ID
     * @param settingId - The ID of the setting to retrieve
     * @returns The setting object, or undefined if not found
     */
    public getSettingObject(settingId: string): Setting | undefined {
        for (const [genre, settings] of Object.entries(this.settings_service.genre_settings)) {
            const setting = settings.find(s => s.id === settingId);
            if (setting) {
                return setting;
            }
        }
        return undefined;
    }
}

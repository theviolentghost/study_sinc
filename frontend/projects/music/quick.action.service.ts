import { Injectable } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';

import { Song_Playlist_Identifier } from './music.media.service';

@Injectable({
  providedIn: 'root'
})
export class QuickActionService {
    quick_action_open: boolean = false;
    playlist_view_color: string = ''; 
    action: string = 'pick_playlist_color';

    constructor(
        private router: Router,
    ) { 
        // Listen for navigation end events
        this.router.events
            .pipe(filter(event => event instanceof NavigationEnd))
            .subscribe((event: NavigationEnd) => {
                this.reset_all_params();
            });
    }

    private reset_all_params(): void {
        this.quick_action_open = false;
        this.playlist_view_color = '';
    }

    public reset(): void {
        this.reset_all_params();
    }

    // Color Contrast Utility Methods (WCAG 2.0 Compliant)

    /**
     * Returns a color that contrasts well with the given background color.
     * Uses WCAG AA standard (4.5:1 contrast ratio).
     * Returns an adjusted color (not pure black/white) that maintains some saturation.
     */
    public get_contrast_color(background_color: string): string {
        if (!background_color) return '';
        const hsl = this.hex_to_hsl(background_color);
        if (!hsl) return ''; // Return empty if conversion fails
        
        const bg_luminance = this.get_perceived_brightness(hsl);
        
        // Try both dark and light options and pick the one with better contrast
        const dark_option = this.find_contrast_color(hsl, bg_luminance, 'dark');
        const light_option = this.find_contrast_color(hsl, bg_luminance, 'light');
        
        // Calculate contrast ratios for both options
        const dark_contrast = this.calculate_contrast_ratio(bg_luminance, dark_option.luminance);
        const light_contrast = this.calculate_contrast_ratio(bg_luminance, light_option.luminance);
        
        // Return the option with better contrast (prefer dark text when possible)
        if (dark_contrast >= 4.5) {
            return dark_option.color;
        } else if (light_contrast >= 4.5) {
            return light_option.color;
        } else {
            // If neither meets WCAG AA standard (4.5:1), return the one with higher contrast
            return dark_contrast > light_contrast ? dark_option.color : light_option.color;
        }
    }

    /**
     * Returns pure black (#000000) or white (#ffffff) for maximum text readability.
     * Uses WCAG AA standard (4.5:1 contrast ratio).
     * Ideal for text elements that need maximum contrast.
     */
    public get_text_contrast_color(background_color: string): string {
        if (!background_color) return '';
        const hsl = this.hex_to_hsl(background_color);
        if (!hsl) return ''; // Return empty if conversion fails
        
        const bg_luminance = this.get_perceived_brightness(hsl);
        
        // Calculate contrast ratios for pure black and pure white
        const black_luminance = 0; // Pure black
        const white_luminance = 1; // Pure white
        
        const black_contrast = this.calculate_contrast_ratio(bg_luminance, black_luminance);
        const white_contrast = this.calculate_contrast_ratio(bg_luminance, white_luminance);
        
        // Return pure black or pure white based on which has better contrast
        // Prefer black text when both meet WCAG AA standard (4.5:1)
        if (black_contrast >= 4.5) {
            return '#000000';
        } else if (white_contrast >= 4.5) {
            return '#ffffff';
        } else {
            // If neither meets WCAG AA, return the one with higher contrast
            return black_contrast > white_contrast ? '#000000' : '#ffffff';
        }
    }

    private find_contrast_color(
        bg_hsl: { h: number, s: number, l: number }, 
        bg_luminance: number, 
        direction: 'dark' | 'light'
    ): { color: string, luminance: number } {
        const target_lightness = direction === 'dark' ? 0.15 : 0.95;
        
        // For grayscale colors, reduce saturation dramatically
        const is_grayscale = bg_hsl.s < 0.15;
        let best_saturation = bg_hsl.s;
        
        if (is_grayscale) {
            best_saturation = 0; // Pure grayscale for text
        } else if (direction === 'dark') {
            // Reduce saturation slightly for dark text to improve readability
            best_saturation = Math.min(bg_hsl.s * 0.7, 0.6);
        } else {
            // Reduce saturation more for light text
            best_saturation = Math.min(bg_hsl.s * 0.4, 0.4);
        }
        
        const color = this.hsl_to_hex(bg_hsl.h, best_saturation, target_lightness);
        const luminance = this.get_perceived_brightness({
            h: bg_hsl.h,
            s: best_saturation,
            l: target_lightness
        });
        
        return { color, luminance };
    }

    private calculate_contrast_ratio(luminance1: number, luminance2: number): number {
        // WCAG contrast ratio formula
        const lighter = Math.max(luminance1, luminance2);
        const darker = Math.min(luminance1, luminance2);
        return (lighter + 0.05) / (darker + 0.05);
    }

    private get_perceived_brightness(hsl: { h: number, s: number, l: number }): number {
        // Convert HSL back to RGB to calculate relative luminance
        const hue_to_rgb = (p: number, q: number, t: number): number => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        
        let r: number, g: number, b: number;
        
        if (hsl.s === 0) {
            r = g = b = hsl.l;
        } else {
            const q = hsl.l < 0.5 ? hsl.l * (1 + hsl.s) : hsl.l + hsl.s - hsl.l * hsl.s;
            const p = 2 * hsl.l - q;
            r = hue_to_rgb(p, q, hsl.h + 1/3);
            g = hue_to_rgb(p, q, hsl.h);
            b = hue_to_rgb(p, q, hsl.h - 1/3);
        }
        
        // Apply gamma correction for more accurate brightness perception
        const gamma_correct = (c: number) => {
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        };
        
        // Calculate relative luminance (WCAG 2.0 formula)
        const luminance = 0.2126 * gamma_correct(r) + 
                         0.7152 * gamma_correct(g) + 
                         0.0722 * gamma_correct(b);
        
        return luminance;
    }

    /**
     * Converts hex, HSL, or CSS variable color to HSL format
     * Supports: #RGB, #RRGGBB, hsl(h, s%, l%), var(--css-variable)
     */
    public hex_to_hsl(color: string): { h: number, s: number, l: number } | null {
        if (!color) return null;
        
        // Handle CSS variables like var(--color-primary)
        if (color.startsWith('var(')) {
            // Extract the CSS variable name
            const varName = color.match(/var\((--[\w-]+)\)/)?.[1];
            if (varName) {
                // Get computed value from document root
                const computedValue = getComputedStyle(document.documentElement)
                    .getPropertyValue(varName)
                    .trim();
                if (computedValue) {
                    color = computedValue;
                } else {
                    // Fallback to a default neutral color
                    return { h: 0, s: 0, l: 0.5 };
                }
            }
        }
        
        // Handle HSL format (hsl(h, s%, l%) or hsl(h deg s% l%))
        const hslMatch = color.match(/hsl\((\d+)(?:deg)?\s*,?\s*(\d+)%\s*,?\s*(\d+)%\)/);
        if (hslMatch) {
            return {
                h: parseInt(hslMatch[1]) / 360,
                s: parseInt(hslMatch[2]) / 100,
                l: parseInt(hslMatch[3]) / 100
            };
        }
        
        // Handle hex format
        let hex = color.replace('#', '');
        
        // Convert 3-digit hex to 6-digit
        if (hex.length === 3) {
            hex = hex.split('').map(c => c + c).join('');
        }
        
        if (hex.length !== 6) {
            // console.warn(`Invalid color format: ${color}`);
            return null;
        }
        
        // Convert hex to RGB
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;
        
        // Convert RGB to HSL
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0;
        let s = 0;
        const l = (max + min) / 2;
        
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            
            switch (max) {
                case r:
                    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
                    break;
                case g:
                    h = ((b - r) / d + 2) / 6;
                    break;
                case b:
                    h = ((r - g) / d + 4) / 6;
                    break;
            }
        }
        
        return { h, s, l };
    }
    
    /**
     * Converts HSL values (0-1 range) to hex color string
     */
    public hsl_to_hex(h: number, s: number, l: number): string {
        // Ensure values are in valid ranges
        h = Math.max(0, Math.min(1, h));
        s = Math.max(0, Math.min(1, s));
        l = Math.max(0, Math.min(1, l));
        
        const hue_to_rgb = (p: number, q: number, t: number): number => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };
        
        let r: number, g: number, b: number;
        
        if (s === 0) {
            r = g = b = l; // achromatic
        } else {
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            r = hue_to_rgb(p, q, h + 1/3);
            g = hue_to_rgb(p, q, h);
            b = hue_to_rgb(p, q, h - 1/3);
        }
        
        const to_hex = (x: number): string => {
            const hex = Math.round(x * 255).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };
        
        return `#${to_hex(r)}${to_hex(g)}${to_hex(b)}`;
    }
}

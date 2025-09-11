import { Component, AfterViewInit, ElementRef, ViewChild, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { 
  trigger, 
  state, 
  style, 
  transition, 
  animate,
} from '@angular/animations';

import { MusicMediaService, Song_Data, DownloadQuality, Song_Playlist, Song_Source } from '../../music.media.service';
import { MusicPlayerService, Player_Error } from '../../music.player.service';
import { PlaylistsService } from '../../playlists.service';
import { HotActionComponent } from '../hot.action/hot.action.component';
import { HotActionService } from '../../hot.action.service';
import { QuickActionComponent } from '../quick.action/quick.action.component';
import { QuickActionService } from '../../quick.action.service';

@Component({
  selector: 'media-player',
  imports: [CommonModule, HotActionComponent, QuickActionComponent],
  templateUrl: './media.player.component.html',
  styleUrl: './media.player.component.css',
  animations: [
    trigger('playerState', [
      state('hidden', style({
        height: '0',
        opacity: 0
      })),
      state('reduced', style({
        height: 'var(--space-7)',
        opacity: 1
      })),
      state('visible', style({
        height: '100%',
        opacity: 1
      })),
      state('dragging', style({
        height: '{{calculatedHeight}}px',
        opacity: 1
      }), { params: { calculatedHeight: 500 } }),
      
      // Transitions
      transition('hidden => visible', [
        animate('700ms cubic-bezier(0.25, 0.8, 0.25, 1)')
      ]),
      transition('visible => hidden', [
        animate('700ms cubic-bezier(0.25, 0.8, 0.25, 1)')
      ]),
      transition('visible => reduced', [
        animate('700ms cubic-bezier(0.25, 0.8, 0.25, 1)')
      ]),
      transition('reduced => visible', [
        animate('700ms cubic-bezier(0.25, 0.8, 0.25, 1)')
      ]),
      transition('* => dragging', [
        animate('0ms') // Instant for dragging
      ]),
      transition('dragging => *', [
        animate('400ms cubic-bezier(0.25, 0.8, 0.25, 1)')
      ])
    ]),
    
    // Content animations
    trigger('contentFade', [
      state('visible', style({ opacity: 1, transform: 'scale(1)' })),
      state('reduced', style({ opacity: 0.8, transform: 'scale(0.95)' })),
      state('hidden', style({ opacity: 0, transform: 'scale(0.9)' })),
      transition('* <=> *', animate('200ms ease-out'))
    ])
  ]
})
export class MediaPlayerComponent implements AfterViewInit, OnDestroy {
    @ViewChild('playerContainer', { static: false }) playerContainer!: ElementRef<HTMLElement>;
    @ViewChild('media', { static: false }) mediaContainer!: ElementRef<HTMLElement>;

    _visibility_status: 'visible' | 'reduced' | 'hidden' = 'hidden';

    set visibility_status(status: 'visible' | 'reduced' | 'hidden') {
        this._visibility_status = status;
        if (status === 'hidden') {
            this.dragOffset = 0; // Reset drag offset when hiding
            this.animationState = 'hidden';
        } else if (status === 'reduced') {
            this.animationState = 'reduced';
        } else {
            this.animationState = 'visible';
        }
    }
    get visibility_status(): 'visible' | 'reduced' | 'hidden' {
        return this._visibility_status;
    }
    buffered_percent = 0;
    buffer_like = false;
    buffer_like_clicked = false;

    // Drag properties
    private isDragging = false;
    private startY = 0;
    private currentDragOffset = 0;
    private get dragThreshold(): number {
        return window.innerHeight * 0.65; // 65% of the viewport height
    }
    private get window_height(): number {
        return window.innerHeight;
    }
    private velocityThreshold = 4;
    private lastTouchTime = 0;
    private lastTouchY = 0;

    // Animation state
    animationState: 'visible' | 'reduced' | 'hidden' | 'dragging' = 'hidden';
    dragOffset = 0;
    calculatedHeight = this.window_height;

    // Orientation detection
    private _isLandscape = false;
    private orientationChangeListener?: () => void; 

    get hot_action_open(): boolean {
        return this.hot_action.hot_action_open;
    }
    get hot_acction_song_data(): Song_Data | null {
        return this.hot_action.song_data;
    }
    get quick_action_open(): boolean {
        return this.quick_action.quick_action_open;
    }

    get current_song_data(): Song_Data | null {
        return this.player.song_data;
    }
    get current_media_data(): Song_Data | null {
        return this.player.media_data;
    }
    get current_playlist_data(): Song_Playlist | null {
        return this.player.playlist;
    }
    is_downloading(video_id: string): boolean {
        return this.media.is_downloading(video_id);
    }
    video_progress(video_id: string): number {
        return this.media.download_progress(video_id); // return the current download progress
    }
    get preloaded_next_song(): boolean {
        return this.player.preloaded_next_song;
    }
    audio_current_time = 0;
    audio_duration = 0;
    player_error: Player_Error | null = null; // Error message if any
    player_hls_level = 0;
    player_quality_update: 'up' | 'down' | 'none' = 'none';
    player_quality_timeout = null;
    user_has_internet = navigator.onLine; // Track internet connectivity

    constructor(
        private media: MusicMediaService,
        private player: MusicPlayerService, 
        private playlists: PlaylistsService, 
        private hot_action: HotActionService,
        private quick_action: QuickActionService
    ) {
        // Initialize orientation detection
        this.setupOrientationDetection();
        
        // check if the user has internet connection
        window.addEventListener('online', () => {
            this.user_has_internet = true;
        });
        window.addEventListener('offline', () => {
            this.user_has_internet = false;
        });
        this.player.open_player.subscribe(() => {
            this._visibility_status = 'visible';
            this.animationState = 'visible';
        });
        this.player.reduce_player.subscribe(() => {
            this._visibility_status = 'reduced';
            this.animationState = 'reduced';
        });
        this.player.track_loaded.subscribe(() => {
            if(this.player.song_data?.liked != this.buffer_like && this.buffer_like_clicked) this.toggle_like(); // sync like button state with song data after loading
            this.buffer_like = false;
            this.buffer_like_clicked = false;
            this.player_error = null; // Reset player error on track load
        });
        this.player.song_changed.subscribe(() => {
            this.buffer_like = false; 
            this.buffer_like_clicked = false;
            this.player_error = null; // Reset player error on song change
        });
        this.player.song_error.subscribe((error: Player_Error) => {
            console.error('Player error:', error);
            this.player_error = error;
        });
        this.player.hls_level_changed.subscribe((level: {index: number, details: any}) => {
            clearTimeout(this.player_quality_timeout);
            if(level.index !== this.player_hls_level) {
                this.player_quality_timeout = setTimeout(()=>{
                    this.player_quality_update = 'none';
                }, 5 * 1000); // 5 sec
                this.player_quality_update = this.player_hls_level > level.index ? 'down' : 'up';
            }
            this.player_hls_level = level.index;
            console.log('HLS level changed to:', level.index);
            console.log('HLS level details:', level.details);
        });
    }

    get player_status(): 'loading' | 'playing' | 'paused' | 'stopped' {
        return this.player.player_status;
    }
    
    get is_seekbar_disabled(): boolean {
        // On iOS, be more permissive about when seeking is allowed
        // Only disable if actually loading a new track or no duration available
        return this.player.loading || this.audio_duration <= 0 || !this.current_song_data;
    }
    get audio_started(): boolean {
        return this.player.started_playing;
    }
    get play_button_icon(): string {
        if( this.player_error ) {
            switch(this.player_error) {
                case Player_Error.NO_AUDIO:
                case Player_Error.COULD_NOT_LOAD:
                    return 'alert-triangle.svg';
                case Player_Error.AUDIO_TIMED_OUT:
                    return 'reload.svg';
            }
        }
        if (this.player_status === 'loading') return 'loader.svg';
        return this.player_status === 'paused' ? 'player-play.svg' : 'player-pause.svg';
    }

    get get_quality_icon(): string {
        if( !this.user_has_internet ) return 'antenna-bars-off.svg'; // Default icon for no internet
        if( this.player_error !== null ) return 'antenna-bars-1.svg'; // Default icon for errors
        if( this.player_hls_level === -1 ) return 'antenna-bars-5.svg';
        if( typeof this.player_hls_level === 'number' ) return `antenna-bars-${this.player_hls_level+2}.svg`;
        return 'antenna-bars-1.svg'; 
    }

    get get_quality_update_icon(): string {
        if(this.player_quality_update === 'up') return 'arrow-narrow-up.svg';
        if(this.player_quality_update === 'down') return 'arrow-narrow-down.svg';
        return '';
    }

    source_options: Map<Song_Source, string> = new Map([
        ['spotify', "#1cd760"],
        ['youtube', "#ff0033"],
        ['musi', "#ff8843"]
    ]);

    get_source_color(source: Song_Source | undefined): string {
        if( !source ) return 'var(--color-primary)'; // gray color for undefined sources
        return this.source_options.get(source) || 'var(--color-primary)'; // default to gray if source not found
    }

    ngOnDestroy(): void {
        // Clean up any remaining document event listeners
        this.removeDocumentMouseListeners();
        
        // Clean up orientation listeners
        if (this.orientationChangeListener) {
            if (screen.orientation) {
                screen.orientation.removeEventListener('change', this.orientationChangeListener);
            }
            window.removeEventListener('orientationchange', this.orientationChangeListener);
            window.removeEventListener('resize', this.orientationChangeListener);
        }
    }

    ngAfterViewInit() {
        const audio = document.getElementById('audio') as HTMLAudioElement;
        audio.ontimeupdate = () => this.audio_current_time = audio.currentTime;
        audio.onloadedmetadata = () => audio.currentTime = 0; // Reset to start when metadata is loaded
        audio.addEventListener('progress', () => {
            if (audio.buffered.length > 0 && audio.duration > 0) {
                const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
                this.buffered_percent = (bufferedEnd / audio.duration) * 100;
            }
            this.audio_duration = this.player.duration || 0; // Ensure duration is set
        });

        this.player.audio_source_element = audio;
        this.player.thumbnail_source_element = document.getElementById('thumbnail') as HTMLImageElement;
        
        this.setupTouchListeners();
    }

    // Touch event handlers
    onTouchStart(event: TouchEvent): void {
        if (this.visibility_status !== 'visible') return;
        
        this.isDragging = true;
        this.startY = event.touches[0].clientY;
        this.lastTouchTime = Date.now();
        this.lastTouchY = this.startY;
        
        // Prevent body scroll
        document.body.style.overflow = 'hidden';
    }

    onTouchMove(event: TouchEvent): void {
        if (!this.isDragging || this.visibility_status !== 'visible') return;
        
        event.preventDefault();
        const currentY = event.touches[0].clientY;
        const deltaY = currentY - this.startY;
        
        // Only allow downward dragging
        if (deltaY > 0) {
            // Apply resistance
            this.currentDragOffset = Math.min(deltaY * 0.8, window.innerHeight * 0.85);
            this.dragOffset = this.currentDragOffset;
            this.animationState = 'dragging';

            this.calculatedHeight = Math.max(0, this.window_height - this.dragOffset); 
        }
        
        // Track velocity
        const now = Date.now();
        if (now - this.lastTouchTime > 16) { // ~60fps throttling
            this.lastTouchTime = now;
            this.lastTouchY = currentY;
        }
    }

    onTouchEnd(event: TouchEvent): void {
        if (!this.isDragging || this.visibility_status !== 'visible') return;
        
        this.isDragging = false;
        document.body.style.overflow = '';
        
        const velocity = this.calculateVelocity();
        const shouldReduce = this.currentDragOffset > this.dragThreshold || velocity > this.velocityThreshold - 2;
        
        if (shouldReduce) {
            this._visibility_status = 'reduced';
            this.animationState = 'reduced';
        } else {
            this.animationState = 'visible';
        }
        
        this.currentDragOffset = 0;
    }

    // Mouse event handlers
    onMouseDown(event: MouseEvent): void {
        if (this.visibility_status !== 'visible') return;
        
        this.isDragging = true;
        this.startY = event.clientY;
        this.lastTouchTime = Date.now();
        this.lastTouchY = this.startY;
        
        // Prevent text selection and other mouse behaviors
        event.preventDefault();
        document.body.style.userSelect = 'none';
        document.body.style.overflow = 'hidden';
        
        // Change cursor to indicate dragging
        document.body.style.cursor = 'grabbing';
        
        // Add document listeners for mouse move and up
        this.addDocumentMouseListeners();
    }

    onMouseMove(event: MouseEvent): void {
        if (!this.isDragging || this.visibility_status !== 'visible') return;
        
        const currentY = event.clientY;
        const deltaY = currentY - this.startY;
        
        // Only allow downward dragging
        if (deltaY > 0) {
            // Apply resistance (slightly more for mouse since it's easier to control)
            this.currentDragOffset = Math.min(deltaY * 0.8, window.innerHeight * 0.85);
            this.dragOffset = this.currentDragOffset;
            this.animationState = 'dragging';

            this.calculatedHeight = Math.max(0, this.window_height - this.dragOffset);
        }
        
        // Track velocity for mouse movements
        const now = Date.now();
        if (now - this.lastTouchTime > 16) { // ~60fps throttling
            this.lastTouchTime = now;
            this.lastTouchY = currentY;
        }
    }

    onMouseUp(event: MouseEvent): void {
        if (!this.isDragging || this.visibility_status !== 'visible') return;
        
        this.isDragging = false;
        
        // Restore body styles
        document.body.style.userSelect = '';
        document.body.style.overflow = '';
        document.body.style.cursor = '';
        
        const velocity = this.calculateVelocity();
        const shouldReduce = this.currentDragOffset > this.dragThreshold || velocity > this.velocityThreshold;
        
        if (shouldReduce) {
            this._visibility_status = 'reduced';
            this.animationState = 'reduced';
        } else {
            this.animationState = 'visible';
        }
        
        this.currentDragOffset = 0;
        
        // Remove document listeners
        this.removeDocumentMouseListeners();
    }

    onMouseLeave(event: MouseEvent): void {
        if (this.isDragging) {
            this.isDragging = false;
            document.body.style.userSelect = '';
            document.body.style.overflow = '';
            document.body.style.cursor = '';
            
            // Snap back to visible when mouse leaves
            this.animationState = 'visible';
            this.currentDragOffset = 0;
            
            // Remove document listeners
            this.removeDocumentMouseListeners();
        }
    }

    private addDocumentMouseListeners(): void {
        document.addEventListener('mousemove', this.boundMouseMove);
        document.addEventListener('mouseup', this.boundMouseUp);
        document.addEventListener('mouseleave', this.boundMouseLeave);
    }

    private removeDocumentMouseListeners(): void {
        document.removeEventListener('mousemove', this.boundMouseMove);
        document.removeEventListener('mouseup', this.boundMouseUp);
        document.removeEventListener('mouseleave', this.boundMouseLeave);
    }

    // Bound methods for proper event listener cleanup
    private boundMouseMove = (event: MouseEvent) => this.onMouseMove(event);
    private boundMouseUp = (event: MouseEvent) => this.onMouseUp(event);
    private boundMouseLeave = (event: MouseEvent) => this.onMouseLeave(event);

    private setupTouchListeners(): void {
        // This method is now empty since we use HTML event bindings
        // Keep it for backwards compatibility if needed
    }

    private calculateVelocity(): number {
        const timeDelta = Date.now() - this.lastTouchTime;
        if (timeDelta === 0) return 0;
        
        const distance = this.currentDragOffset;
        return distance / timeDelta;
    }

    // Get animation parameters - add method if not already present
    getAnimationParams() {
        return { value: this.animationState, params: { calculatedHeight: this.calculatedHeight } };
    }

    toggle_visibility(): void {
        if (this.visibility_status === 'visible') {
            this._visibility_status = 'reduced';
            this.animationState = 'reduced';
        } else if (this.visibility_status === 'reduced') {
            this._visibility_status = 'visible';
            this.animationState = 'visible';
        }
    }
    toggle_like(): void {
        this.buffer_like = !this.buffer_like; 
        this.buffer_like_clicked = true; 

        if(!this.current_song_data || this.player.loading) return;
        this.buffer_like = false; 
        this.current_song_data.liked = !this.current_song_data?.liked;
        // this.media.save_song_to_indexDB(this.current_song_data.id.video_id, this.current_song_data);
        if(this.current_song_data.liked) {
            console.log('Adding song to favorites:', this.current_song_data);
            this.playlists.add_to_favorites(this.current_song_data);
        } else {
            this.playlists.remove_from_favorites(this.current_song_data);
        }
    }
    toggle_shuffle(): void {
        this.player.shuffle = !this.player.shuffle;
    }
    get shuffle(): boolean {
        return this.player.shuffle;
    }
    toggle_repeat(): void {
        this.player.repeat = (this.player.repeat + 1) % 2; // Cycle through 0, 1
    }
    get repeat(): number {
        return this.player.repeat;
    }
    get disco_mode(): boolean {
        return this.player.disco_mode;
    }
    toggle_disco_mode(): void {
        this.player.disco_mode = !this.player.disco_mode;
    }
    toggle_play(): void {
        this.player.toggle_play();
    }
    previous(): void {
        this.player.skip_to_previous();
    }
    next(): void {
        this.player.skip_to_next(true);
    }
    async get_song_artwork(song: Song_Data | null): Promise<string | null> {
        if (!song) return null;
        return await this.media.get_song_artwork(song) || '';
    }
    download_song(): void {
        if (!this.current_song_data) return;
        if (this.current_song_data.downloaded || this.media.is_downloading(this.media.song_key(this.current_song_data.id))) {
            console.warn('Song already downloaded');
            return;
        }
        this.media.request_download(this.media.song_key(this.current_song_data.id), { quality: DownloadQuality.Q0, bit_rate: '128K' });
    }

    get_thumbnail_background(song: Song_Data | null): string {
        if (!song || !song.colors) return 'var(--color-background)';
        
        // Check if we have multiple colors (assuming colors.common is an array of colors)
        if (song.colors.common && Array.isArray(song.colors.common) && song.colors.common.length > 1) {
            const colors = song.colors.common;
            
            // Different gradient styles based on number of colors
            switch (colors.length) {
                case 2:
                    // Simple diagonal gradient
                    return `linear-gradient(120deg, ${colors[0]} 0%, ${colors[1]} 100%)`;
                    
                case 3:
                    // Three-color diagonal gradient
                    return `linear-gradient(120deg, ${colors[0]} 0%, ${colors[1]} 50%, ${colors[2]} 100%)`;
                    
                case 4:
                    // Radial gradient from center
                    return `radial-gradient(ellipse at center, ${colors[0]} 0%, ${colors[1]} 30%, ${colors[2]} 70%, ${colors[3]} 100%)`;
                    
                case 5:
                    // Complex multi-stop gradient
                    return `linear-gradient(120deg, ${colors[0]} 0%, ${colors[1]} 15%, ${colors[2]} 50%, ${colors[3]} 85%, ${colors[4]} 100%)`;
                    
                default:
                    if (colors.length > 5) {
                        // For many colors, create a conic gradient (circular rainbow effect)
                        const colorStops = colors.map((color, index) => 
                            `${color} ${(index * 360) / colors.length}deg`
                        ).join(', ');
                        return `conic-gradient(from 0deg, ${colorStops})`;
                    } else {
                        // Fallback for edge cases
                        return `linear-gradient(120deg, ${colors[0]} 0%, ${colors[colors.length - 1]} 100%)`;
                    }
            }
        }
        
        // Fallback to primary color with subtle gradient
        if (song.colors.primary) {
            return `linear-gradient(120deg, ${song.colors.primary} 0%, rgba(255, 255, 255, 0.1) 100%)`;
        }
        
        // Final fallback
        return 'var(--color-background)';
    }

    add_song_to_playlist(): void {
        this.hot_action.open_hot_action(this.player.song_data, this.player.song_data?.id.source || 'youtube', 'add_to_playlist');
    }

    open_queue_management(): void {
        this.quick_action.quick_action_open = true;
        this.quick_action.action = 'queue_management';
    }

    seek_value: number = -1;
    on_seek(event: any): void {
        this.seek_value = event.target.value;
    }
    on_seek_end(event: any): void {
        this.player.seek_to(this.seek_value);
        this.seek_value = -1;
    }

    seconds_to_time(seconds: number): string {
        if (isNaN(seconds) || seconds < 0) return '00:00';
        seconds = Math.max(0, seconds);
        seconds = Math.floor(seconds); // Ensure seconds is an integer
        if (seconds === Infinity) return '00:00'; // Handle edge case for Infinity
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }









    
    // Orientation detection methods
    private setupOrientationDetection(): void {
        // Initial orientation check
        this.updateOrientation();
        
        // Setup orientation change listeners
        this.orientationChangeListener = () => {
            // Small delay to ensure the orientation change is complete
            setTimeout(() => {
                this.updateOrientation();
            }, 100);
        };
        
        // Listen for orientation changes (multiple event types for better compatibility)
        if (screen.orientation) {
            screen.orientation.addEventListener('change', this.orientationChangeListener);
        }
        
        // Fallback for older browsers
        window.addEventListener('orientationchange', this.orientationChangeListener);
        
        // Also listen to resize events as a fallback
        window.addEventListener('resize', this.orientationChangeListener);
    }

    private updateOrientation(): void {
        // Method 1: Use screen.orientation (modern browsers)
        if (screen.orientation) {
            this._isLandscape = screen.orientation.angle === 90 || screen.orientation.angle === -90;
        }
        // Method 2: Use window.orientation (older browsers)
        else if (typeof (window as any).orientation !== 'undefined') {
            this._isLandscape = Math.abs((window as any).orientation) === 90;
        }
        // Method 3: Fallback using window dimensions
        else {
            this._isLandscape = window.innerWidth > window.innerHeight;
        }
        
        console.log('📱 Orientation changed:', this._isLandscape ? 'Landscape' : 'Portrait');
        
        // Trigger any orientation-specific logic here
        this.onOrientationChange();
    }

    private onOrientationChange(): void {
        // Add your orientation-specific logic here
        if (this._isLandscape) {
            // Landscape-specific logic
            console.log('📱 Switched to landscape mode');
            
            // Example: You might want to expand the player in landscape
            // if (this.visibility_status === 'reduced') {
            //     this.visibility_status = 'visible';
            // }
            
            // Example: Adjust drag thresholds for landscape
            // this.dragThreshold = window.innerWidth * 0.5;
            
        } else {
            // Portrait-specific logic
            console.log('📱 Switched to portrait mode');
            
            // Example: You might want to compress the player in portrait
            // if (this.visibility_status === 'visible') {
            //     this.visibility_status = 'reduced';
            // }
            
            // Example: Reset drag thresholds for portrait
            // this.dragThreshold = window.innerHeight * 0.65;
        }
        
        // Force a reflow/repaint to ensure layout updates
        this.calculatedHeight = this.window_height;
    }

    // Public getter for orientation
    get isLandscape(): boolean {
        return this._isLandscape;
    }

    get isPortrait(): boolean {
        return !this._isLandscape;
    }

    // Method to get orientation-specific CSS classes
    get orientation_class(): string {
        return this._isLandscape ? 'landscape' : 'portrait';
    }
}

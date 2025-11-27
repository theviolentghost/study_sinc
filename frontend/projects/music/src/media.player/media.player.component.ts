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
import { MusicPlayerService } from '../../music.player.service';
import { PlaylistsService } from '../../playlists.service';
import { HotActionComponent } from '../hot.action/hot.action.component';
import { HotActionService } from '../../hot.action.service';
import { QuickActionComponent } from '../quick.action/quick.action.component';
import { QuickActionService } from '../../quick.action.service';
import { SettingsService } from '../../settings.service';
import { Skip_Event, Skip_Result } from '../../media.player/playlist.manager';

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
            this.player.clear_playlist_color.emit(); // Clear main color when hiding
        } else if (status === 'reduced') {
            this.animationState = 'reduced';
            // this.player.clear_playlist_color.emit(); // Clear main color when reducing
            return;
        } else {
            this.animationState = 'visible';
            this.player.playlist_changed.emit(); // Refresh playlist view when expanding
        }
    }
    get visibility_status(): 'visible' | 'reduced' | 'hidden' {
        return this._visibility_status;
    }
    get buffered_percent(): number {
        return this.player.buffered_percent;
    }
    buffer_like = false;
    buffer_like_clicked = false;

    // Drag properties
    private isDragging = false;
    private startY = 0;
    private currentDragOffset = 0;
    private hasSwipedUpward = false; // Track if user swiped upward to cancel close
    private maxDragOffset = 0; // Track the maximum drag to detect upward swipes
    
    // Horizontal swipe properties for media-header
    private isHorizontalSwiping = false;
    private startX = 0;
    private currentX = 0;
    private horizontalDragOffset = 0;
    private readonly swipeThreshold = 30; // Minimum distance to trigger skip
    private readonly swipeVelocityThreshold = 0.3; // Minimum velocity to trigger skip
    private lastSwipeTime = 0;
    private lastSwipeX = 0;
    private headerTouchStartTime = 0;
    private headerHasMoved = false;
    private readonly clickThreshold = 10; // Maximum movement allowed for a click (px)

    // Seek bar dragging properties (Apple-style)
    isSeekBarDragging = false;
    private seekBarStartValue = 0;
    private seekBarStartX = 0;
    private seekBarDragSensitivity = 2.0; // Pixels per second
    seekBarPreviewValue = 0;
    private seekBarInitialTouch = false;
    
    private get dragThreshold(): number {
        return window.innerHeight * 0.65; // 65% of the viewport height
    }
    private get window_height(): number {
        return window.innerHeight;
    }
    private velocityThreshold = 2.5;
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
        return this.player.current;
    }
    set current_song_data(value: Song_Data | null) {
        this.player.set_current_song(value);
    }
    get current_media_data(): Song_Data | null {
        return this.player.media_data || this.current_song_data; 
    }
    get current_playlist_data(): Song_Playlist | null {
        return this.player.playlist_data;
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
    get previous_song_exists(): boolean {
        return this.player.previous_song_exists;
    }
    get prefers_shuffle_play_over_dj_play(): boolean {
        return this.settings.prefers_shuffle_play_over_dj_play;
    }
    get is_desired_play_method_active(): boolean {
        // if prefers shuffle and shuffle is active, or prefers dj play and disco mode is active
        return this.player.shuffle;
        // return (this.settings.prefers_shuffle_play_over_dj_play && this.player.shuffle) || (!this.settings.prefers_shuffle_play_over_dj_play && this.player.disco_mode);
    }
    get audio_current_time(): number {
        return this.player.song_time_elapsed;
    }
    get audio_duration(): number {
        return this.player.song_duration;
    }
    get is_duration_accurate(): boolean {
        return this.player.is_duration_accurate;
    }
    get is_progress_accurate(): boolean {
        return this.player.is_progress_accurate && this.player.player_status !== 'stopped';
    }
    get loading_state(): 'fetching_video_id' | 'fetching_audio_stream' | 'fetching_audio_data' | 'loaded' | null {
        return this.player.loading_state;
    }
    get loading_state_text(): string {
        switch(this.loading_state) {
            case 'fetching_video_id': return 'Fetching Video ID';
            case 'fetching_audio_stream': return 'Fetching Audio Stream';
            case 'fetching_audio_data': return 'Fetching Audio Data';
            case 'loaded': 
            default: return '';
        }
    }
    player_error: string | null = null; // Error message if any
    player_hls_level = 0;
    player_quality_update: 'up' | 'down' | 'none' = 'none';
    player_quality_timeout = null;
    user_has_internet = navigator.onLine; // Track internet connectivity

    constructor(
        private media: MusicMediaService,
        private player: MusicPlayerService, 
        private playlists: PlaylistsService, 
        private hot_action: HotActionService,
        private quick_action: QuickActionService,
        private settings: SettingsService
    ) {
        // Initialize orientation detection
        this.setupOrientationDetection();

        // this.visibility_status = 'visible';
        
        // check if the user has internet connection
        window.addEventListener('online', () => {
            this.user_has_internet = true;
        });
        window.addEventListener('offline', () => {
            this.user_has_internet = false;
        });
        this.player.open_player.subscribe(() => {
            this.visibility_status = 'visible';
            this.animationState = 'visible';
            // this.player.playlist_changed.emit();
        });
        this.player.reduce_player.subscribe(() => {
            this.visibility_status = 'reduced';
            this.animationState = 'reduced';
        });
        // this.player.track_loaded.subscribe(() => {
        //     if(this.player.song_data?.liked != this.buffer_like && this.buffer_like_clicked) this.toggle_like(); // sync like button state with song data after loading
        //     this.buffer_like = false;
        //     this.buffer_like_clicked = false;
        //     this.player_error = null; // Reset player error on track load
        // });
        // this.player.song_changed.subscribe(() => {
        //     this.buffer_like = false; 
        //     this.buffer_like_clicked = false;
        //     this.player_error = null; // Reset player error on song change
        // });
        // this.player.song_error.subscribe((error: Player_Error) => {
        //     console.error('Player error:', error);
        //     this.player_error = error;
        // });
        // this.player.hls_level_changed.subscribe((level: {index: number, details: any, levels: number}) => {
        //     this.total_hls_levels = level.levels;
        //     clearTimeout(this.player_quality_timeout);
        //     if(level.index !== this.player_hls_level) {
        //         this.player_quality_timeout = setTimeout(()=>{
        //             this.player_quality_update = 'none';
        //         }, 5 * 1000); // 5 sec
        //         this.player_quality_update = this.player_hls_level > level.index ? 'down' : 'up';
        //     }
        //     this.player_hls_level = level.index;
        //     console.log('HLS level changed to:', level.index);
        //     console.log('HLS level details:', level.details);
        //     console.log('HLS level total levels:', level.levels);
        // });
    }

    get player_status(): 'playing' | 'paused' | 'stopped' {
        return this.player.player_status;
    }
    
    get is_seekbar_disabled(): boolean {
        // On iOS, be more permissive about when seeking is allowed
        // Only disable if actually loading a new track or no duration available
        return this.player.player_status === 'stopped' || this.audio_duration <= 0;
    }
    get audio_started(): boolean {
        // return this.player.loaded_current_song;
        return true;
    }
    get play_button_icon(): string {
        // if( this.player_error ) {
        //     switch(this.player_error) {
        //         case Player_Error.NO_AUDIO:
        //         case Player_Error.COULD_NOT_LOAD:
        //             return 'alert-triangle.svg';
        //         case Player_Error.AUDIO_TIMED_OUT:
        //             return 'reload.svg';
        //     }
        // }
        if (this.player_status === 'stopped') return 'loader.svg';
        return this.player_status === 'paused' ? 'player-play.svg' : 'player-pause.svg';
    }

    get get_quality_icon(): string {
        if( !this.user_has_internet ) return 'antenna-bars-off.svg'; // Default icon for no internet
        // if( this.player_error !== null ) return 'antenna-bars-1.svg'; // Default icon for errors
        if( this.player_hls_level === -1 ) return 'antenna-bars-5.svg';
        if( typeof this.player_hls_level === 'number' ) return `antenna-bars-${this.player_hls_level+2 - this.minimum_hls_level}.svg`;
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
        
        // Clean up horizontal swipe listeners
        document.removeEventListener('mousemove', this.boundHeaderMouseMove);
        document.removeEventListener('mouseup', this.boundHeaderMouseUp);
        
        // Reset any visual feedback classes
        const headerElement = document.querySelector('.media-header') as HTMLElement;
        const backgroundElement = document.querySelector('.media-info-background') as HTMLElement;
        
        if (headerElement) {
            headerElement.style.transform = '';
            headerElement.style.transition = '';
        }
        
        if (backgroundElement) {
            backgroundElement.classList.remove('swiping', 'swipe-left', 'swipe-right');
        }
        
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
        const thumbnail = document.getElementById('thumbnail') as HTMLImageElement;

        this.player.set_audio_element(audio);
        this.player.set_thumbnail_element(thumbnail);

        this.setupTouchListeners();
    }

    // Touch event handlers
    onTouchStart(event: TouchEvent): void {
        if (this.visibility_status !== 'visible') return;
        
        this.isDragging = true;
        this.startY = event.touches[0].clientY;
        this.lastTouchTime = Date.now();
        this.lastTouchY = this.startY;
        this.hasSwipedUpward = false; // Reset upward swipe flag
        this.maxDragOffset = 0; // Reset max drag offset
        
        // Increase z-index during drag
        const draggableElement = document.querySelector('.draggable') as HTMLElement;
        if (draggableElement) {
            draggableElement.style.zIndex = '9999';
        }
        
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
            // Apply resistance - optimized calculation
            const resistance = 1.2;
            const maxDrag = this.window_height * 0.85;
            this.currentDragOffset = Math.min(deltaY * resistance, maxDrag);
            
            // Detect upward swipe (user is undoing their close gesture)
            if (this.currentDragOffset < this.maxDragOffset - 5) { // 5px threshold to avoid jitter
                this.hasSwipedUpward = true;
            }
            
            // Update max drag offset
            if (this.currentDragOffset > this.maxDragOffset) {
                this.maxDragOffset = this.currentDragOffset;
            }
            
            this.dragOffset = this.currentDragOffset;
            this.animationState = 'dragging';
            
            // Optimized: Only update calculatedHeight every other frame to reduce calculations
            this.calculatedHeight = this.window_height - this.dragOffset;
        }
        
        // Optimized velocity tracking - reduced frequency
        const now = Date.now();
        if (now - this.lastTouchTime > 32) { // ~30fps throttling (was 60fps)
            this.lastTouchTime = now;
            this.lastTouchY = currentY;
        }
    }

    onTouchEnd(event: TouchEvent): void {
        if (!this.isDragging || this.visibility_status !== 'visible') return;
        
        this.isDragging = false;
        document.body.style.overflow = '';
        
        // Reset z-index
        const draggableElement = document.querySelector('.draggable') as HTMLElement;
        if (draggableElement) {
            draggableElement.style.zIndex = '';
        }
        
        // If user swiped upward at any point, always stay open
        if (this.hasSwipedUpward) {
            this.animationState = 'visible';
            this.currentDragOffset = 0;
            this.maxDragOffset = 0;
            return;
        }
        
        const velocity = this.calculateVelocity();
        const shouldReduce = this.currentDragOffset > this.dragThreshold || velocity > this.velocityThreshold - 2;
        
        if (shouldReduce) {
            this.visibility_status = 'reduced';
            this.animationState = 'reduced';
        } else {
            this.animationState = 'visible';
        }
        
        this.currentDragOffset = 0;
        this.maxDragOffset = 0;
    }

    // Mouse event handlers
    onMouseDown(event: MouseEvent): void {
        if (this.visibility_status !== 'visible') return;
        
        this.isDragging = true;
        this.startY = event.clientY;
        this.lastTouchTime = Date.now();
        this.lastTouchY = this.startY;
        this.hasSwipedUpward = false; // Reset upward swipe flag
        this.maxDragOffset = 0; // Reset max drag offset
        
        // Increase z-index during drag
        const draggableElement = document.querySelector('.draggable') as HTMLElement;
        if (draggableElement) {
            draggableElement.style.zIndex = '9999';
        }
        
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
            // Apply resistance - optimized calculation
            const resistance = 0.8;
            const maxDrag = this.window_height * 0.85;
            this.currentDragOffset = Math.min(deltaY * resistance, maxDrag);
            
            // Detect upward swipe (user is undoing their close gesture)
            if (this.currentDragOffset < this.maxDragOffset - 5) { // 5px threshold to avoid jitter
                this.hasSwipedUpward = true;
            }
            
            // Update max drag offset
            if (this.currentDragOffset > this.maxDragOffset) {
                this.maxDragOffset = this.currentDragOffset;
            }
            
            this.dragOffset = this.currentDragOffset;
            this.animationState = 'dragging';
            
            // Optimized: Reduced recalculation
            this.calculatedHeight = this.window_height - this.dragOffset;
        }
        
        // Optimized velocity tracking - reduced frequency
        const now = Date.now();
        if (now - this.lastTouchTime > 32) { // ~30fps throttling (was 60fps)
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
        
        // Reset z-index
        const draggableElement = document.querySelector('.draggable') as HTMLElement;
        if (draggableElement) {
            draggableElement.style.zIndex = '';
        }
        
        // If user swiped upward at any point, always stay open
        if (this.hasSwipedUpward) {
            this.animationState = 'visible';
            this.currentDragOffset = 0;
            this.maxDragOffset = 0;
            this.removeDocumentMouseListeners();
            return;
        }
        
        const velocity = this.calculateVelocity();
        const shouldReduce = this.currentDragOffset > this.dragThreshold || velocity > this.velocityThreshold;
        
        if (shouldReduce) {
            this.visibility_status = 'reduced';
            this.animationState = 'reduced';
        } else {
            this.animationState = 'visible';
        }
        
        this.currentDragOffset = 0;
        this.maxDragOffset = 0;
        
        // Remove document listeners
        this.removeDocumentMouseListeners();
    }

    onMouseLeave(event: MouseEvent): void {
        if (this.isDragging) {
            this.isDragging = false;
            document.body.style.userSelect = '';
            document.body.style.overflow = '';
            document.body.style.cursor = '';
            
            // Reset z-index
            const draggableElement = document.querySelector('.draggable') as HTMLElement;
            if (draggableElement) {
                draggableElement.style.zIndex = '';
            }
            
            // Snap back to visible when mouse leaves
            this.animationState = 'visible';
            this.currentDragOffset = 0;
            this.maxDragOffset = 0;
            
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
            this.visibility_status = 'reduced';
            this.animationState = 'reduced';
        } else if (this.visibility_status === 'reduced') {
            this.visibility_status = 'visible';
            this.animationState = 'visible';
        }
    }
    toggle_like(): void {
        this.buffer_like = !this.buffer_like; 
        this.buffer_like_clicked = true; 

        if (!this.current_song_data) return;
        this.buffer_like = false;
        this.current_song_data.liked = !this.current_song_data?.liked;
        this.media.save_song_to_indexDB(this.current_song_data.id.video_id, this.current_song_data);
        if (this.current_song_data.liked) {
            console.log('Adding song to favorites:', this.current_song_data);
            this.playlists.add_to_favorites(this.current_song_data);
        } else {
            this.playlists.remove_from_favorites(this.current_song_data);
        }
    }
    toggle_shuffle(): void {
        this.player.shuffle = !this.player.shuffle;
    }
    toggle_disco(): void {
        // nothin
    }
    toggle_desired_play_method(): void {
        // Toggle between shuffle and disco mode based on user preference
        if (this.settings.prefers_shuffle_play_over_dj_play) {
            this.toggle_shuffle();
        } else {
            this.toggle_disco_mode();
        }
    }
    get shuffle(): boolean {
        return this.player.shuffle;
    }
    toggle_repeat(): void {
        this.player.repeat = !this.player.repeat; // Cycle through 0, 1
    }
    get repeat(): boolean {
        return this.player.repeat;
    }
    get disco_mode(): boolean {
        // return this.player.disco_mode;
        return false;
    }
    toggle_disco_mode(): void {
        // this.player.disco_mode = !this.player.disco_mode;
    }
    toggle_play(): void {
        this.player.toggle_play();
    }
    previous(): void {
        const next_exists = this.player.preloaded_next_song;
        // should right fade
        // if(!this.previous_song_exists) return;
        const result = this.player.skip_to_previous();

        if(result === Skip_Result.REPLAY) {
            // add something later
            return;
        }

        // document.getElementById('bar-main-right-temp')?.classList.remove('skip-previous');

        // do animation
        if(next_exists) {
            document.getElementById('bar-main-right')?.classList.add('is-next');
            document.getElementById('bar-main-right-merger')?.classList.add('is-next');
            document.getElementById('bar-main-right-temp')?.classList.add('is-next');
            setTimeout(() => {
                document.getElementById('bar-main-right')?.classList.remove('is-next');
                document.getElementById('bar-main-right-merger')?.classList.remove('is-next');
                document.getElementById('bar-main-right-temp')?.classList.remove('is-next');
            }, 350); // Match the duration of the CSS animation
        }
        document.getElementById('bar-main-left')?.classList.add('skip-previous');
        document.getElementById('bar-main-left-merger')?.classList.add('skip-previous');
        document.getElementById('bar-main-left-temp')?.classList.add('skip-previous');
        document.getElementById('bar-main-right')?.classList.add('skip-previous');
        document.getElementById('bar-main-right-merger')?.classList.add('skip-previous');
        document.getElementById('bar-main-right-temp')?.classList.add('skip-previous');

        setTimeout(() => {
            document.getElementById('bar-main-left')?.classList.remove('skip-previous');
            document.getElementById('bar-main-left-merger')?.classList.remove('skip-previous');
            document.getElementById('bar-main-left-temp')?.classList.remove('skip-previous');
            document.getElementById('bar-main-right')?.classList.remove('skip-previous');
            document.getElementById('bar-main-right-merger')?.classList.remove('skip-previous');
            document.getElementById('bar-main-right-temp')?.classList.remove('skip-previous');
        }, 350);
    }
    next(): void {
        const previous_exists = this.previous_song_exists;
        this.player.skip_to_next(Skip_Event.USER_INITIATED);

        // document.getElementById('bar-main-right-temp')?.classList.remove('skip-previous');
        // do animation
        if(!previous_exists) {
            document.getElementById('bar-main-left')?.classList.add('no-previous');
            document.getElementById('bar-main-left-merger')?.classList.add('no-previous');
            document.getElementById('bar-main-left-temp')?.classList.add('no-previous');
            setTimeout(() => {
                document.getElementById('bar-main-left')?.classList.remove('no-previous');
                document.getElementById('bar-main-left-merger')?.classList.remove('no-previous');
                document.getElementById('bar-main-left-temp')?.classList.remove('no-previous');
            }, 350); // Match the duration of the CSS animation
        }
        document.getElementById('bar-main-left')?.classList.add('skip-next');
        document.getElementById('bar-main-left-merger')?.classList.add('skip-next');
        document.getElementById('bar-main-left-temp')?.classList.add('skip-next');
        document.getElementById('bar-main-right')?.classList.add('skip-next');
        document.getElementById('bar-main-right-merger')?.classList.add('skip-next');
        document.getElementById('bar-main-right-temp')?.classList.add('skip-next');

        setTimeout(() => {
            document.getElementById('bar-main-left')?.classList.remove('skip-next');
            document.getElementById('bar-main-left-merger')?.classList.remove('skip-next');
            document.getElementById('bar-main-left-temp')?.classList.remove('skip-next');
            document.getElementById('bar-main-right')?.classList.remove('skip-next');
            document.getElementById('bar-main-right-merger')?.classList.remove('skip-next');
            document.getElementById('bar-main-right-temp')?.classList.remove('skip-next');
        }, 350); // Match the duration of the CSS animation

    }
    async get_song_artwork(song: Song_Data | null): Promise<string | null> {
        if (!song) return null;
        return await this.media.get_song_artwork(song) || '';
    }

    // Debug methods for quick actions
    debug_like_click(event: MouseEvent): void {
        console.log('Like button clicked');
        this.toggle_like();
        event.stopPropagation();
        event.preventDefault();
    }

    debug_play_click(event: MouseEvent): void {
        console.log('Play button clicked');
        this.toggle_play();
        event.stopPropagation();
        event.preventDefault();
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
                    return `linear-gradient(120deg, ${colors[0]} 0%, ${colors[1]} 100%)`;
                case 3:
                    return `linear-gradient(120deg, ${colors[0]} 0%, ${colors[1]} 50%, ${colors[2]} 100%)`;
                    
                case 4:
                    return `linear-gradient(120deg, ${colors[0]} 0%, ${colors[1]} 20%, ${colors[2]} 75%, ${colors[3]} 100%)`;
                    
                case 5:
                    return `linear-gradient(120deg, ${colors[0]} 0%, ${colors[1]} 15%, ${colors[2]} 50%, ${colors[3]} 85%, ${colors[4]} 100%)`;
                default:
                    break;
            }
        }
        
        // Fallback to primary color with subtle gradient
        if (song.colors.primary) {
            return `linear-gradient(120deg, ${song.colors.primary} 0%, rgba(0, 0, 0, 1) 100%)`;
        }
        
        // Final fallback
        return 'var(--color-background)';
    }

    add_song_to_playlist(): void {
        this.hot_action.open_hot_action(this.player.current, this.player.current?.id.source || 'youtube', 'add_to_playlist');
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

    // Horizontal swipe methods for media-header
    onHeaderTouchStart(event: TouchEvent): void {
        if (this.visibility_status !== 'reduced') return;
        
        this.isHorizontalSwiping = true;
        this.startX = event.touches[0].clientX;
        this.currentX = this.startX;
        this.horizontalDragOffset = 0;
        this.lastSwipeTime = Date.now();
        this.lastSwipeX = this.startX;
        this.headerTouchStartTime = Date.now();
        this.headerHasMoved = false;
        
        // Don't prevent default initially - let's see if it's a click or swipe
    }

    onHeaderTouchMove(event: TouchEvent): void {
        if (!this.isHorizontalSwiping || this.visibility_status !== 'reduced') return;
        
        this.currentX = event.touches[0].clientX;
        this.horizontalDragOffset = this.currentX - this.startX;
        
        // Check if user has moved enough to be considered a swipe
        if (Math.abs(this.horizontalDragOffset) > this.clickThreshold) {
            this.headerHasMoved = true;
            // Now prevent default since we're clearly swiping
            event.preventDefault();
            event.stopPropagation();
        }
        
        // Only proceed with swipe logic if we've moved enough
        if (!this.headerHasMoved) return;
        
        // Apply resistance to the drag
        const resistance = 0.6;
        this.horizontalDragOffset *= resistance;
        
        // Track velocity for better gesture recognition
        const now = Date.now();
        if (now - this.lastSwipeTime > 16) { // ~60fps throttling
            this.lastSwipeTime = now;
            this.lastSwipeX = this.currentX;
        }
        
        // Visual feedback: Apply transform to media-header
        const backgroundElement = document.querySelector('.media-info-background') as HTMLElement;
        
        if (backgroundElement) {
            backgroundElement.style.transform = `translateX(${this.horizontalDragOffset}px)`;
            backgroundElement.style.transition = 'none';
        }
        
        if (backgroundElement) {
            // Add visual feedback classes based on swipe direction
            backgroundElement.classList.add('swiping');
            backgroundElement.classList.remove('swipe-left', 'swipe-right');
            
            if (Math.abs(this.horizontalDragOffset) > 30) { // Show direction indicator after 30px
                if (this.horizontalDragOffset > 0) {
                    backgroundElement.classList.add('swipe-right');
                } else {
                    backgroundElement.classList.add('swipe-left');
                }
            }
        }
    }

    onHeaderTouchEnd(event: TouchEvent): void {
        if (!this.isHorizontalSwiping || this.visibility_status !== 'reduced') return;
        
        this.isHorizontalSwiping = false;
        
        // Check if this was a swipe (significant movement)
        const touchDuration = Date.now() - this.headerTouchStartTime;
        const isSwipe = this.headerHasMoved && Math.abs(this.horizontalDragOffset) > this.clickThreshold;
        
        // Reset visual feedback
        const backgroundElement = document.querySelector('.media-info-background') as HTMLElement;
        
        if (backgroundElement) {
            backgroundElement.style.transform = '';
            backgroundElement.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';
        }
        
        if (backgroundElement) {
            backgroundElement.classList.remove('swiping', 'swipe-left', 'swipe-right');
        }
        
        if (isSwipe) {
            // Handle as swipe
            const swipeDistance = Math.abs(this.horizontalDragOffset);
            const swipeVelocity = this.calculateHorizontalVelocity();
            const isRightSwipe = this.horizontalDragOffset > 0;
            
            // Check if swipe should trigger skip
            const shouldSkip = swipeDistance > this.swipeThreshold || swipeVelocity > this.swipeVelocityThreshold;
            
            if (shouldSkip) {
                if (isRightSwipe) {
                    // Swipe right: previous track
                    this.previous();
                } else {
                    // Swipe left: next track
                    this.next();
                }
            }
            
            // Prevent the click event from firing after a swipe
            event.preventDefault();
            event.stopPropagation();
        }
        // For clicks/taps, let the click handler deal with it
        
        // Reset values
        this.horizontalDragOffset = 0;
        this.currentX = 0;
        this.headerHasMoved = false;
    }

    // Mouse events for horizontal swipe on media-header
    onHeaderMouseDown(event: MouseEvent): void {
        if (this.visibility_status !== 'reduced') return;
        
        this.isHorizontalSwiping = true;
        this.startX = event.clientX;
        this.currentX = this.startX;
        this.horizontalDragOffset = 0;
        this.lastSwipeTime = Date.now();
        this.lastSwipeX = this.startX;
        this.headerTouchStartTime = Date.now();
        this.headerHasMoved = false;
        
        // Don't prevent default initially - let's see if it's a click or drag
        
        // Add document listeners for mouse events
        document.addEventListener('mousemove', this.boundHeaderMouseMove);
        document.addEventListener('mouseup', this.boundHeaderMouseUp);
    }

    onHeaderMouseMove(event: MouseEvent): void {
        if (!this.isHorizontalSwiping || this.visibility_status !== 'reduced') return;
        
        this.currentX = event.clientX;
        this.horizontalDragOffset = this.currentX - this.startX;
        
        // Check if user has moved enough to be considered a drag
        if (Math.abs(this.horizontalDragOffset) > this.clickThreshold) {
            this.headerHasMoved = true;
            // Now prevent default since we're clearly dragging
            event.preventDefault();
            event.stopPropagation();
        }
        
        // Only proceed with drag logic if we've moved enough
        if (!this.headerHasMoved) return;
        
        // Apply resistance
        const resistance = 0.6;
        this.horizontalDragOffset *= resistance;
        
        // Track velocity
        const now = Date.now();
        if (now - this.lastSwipeTime > 16) {
            this.lastSwipeTime = now;
            this.lastSwipeX = this.currentX;
        }
        
        // Visual feedback
        // const headerElement = document.querySelector('.media-header') as HTMLElement;
        const backgroundElement = document.querySelector('.media-info-background') as HTMLElement;
        
        if (backgroundElement) {
            backgroundElement.style.transform = `translateX(${this.horizontalDragOffset}px)`;
            backgroundElement.style.transition = 'none';
        }
        
        if (backgroundElement) {
            // Add visual feedback classes based on swipe direction
            backgroundElement.classList.add('swiping');
            backgroundElement.classList.remove('swipe-left', 'swipe-right');
            
            if (Math.abs(this.horizontalDragOffset) > 30) { // Show direction indicator after 30px
                if (this.horizontalDragOffset > 0) {
                    backgroundElement.classList.add('swipe-right');
                } else {
                    backgroundElement.classList.add('swipe-left');
                }
            }
        }
    }

    onHeaderMouseUp(event: MouseEvent): void {
        if (!this.isHorizontalSwiping || this.visibility_status !== 'reduced') return;
        
        this.isHorizontalSwiping = false;
        
        // Check if this was a drag (significant movement)
        const isDrag = this.headerHasMoved && Math.abs(this.horizontalDragOffset) > this.clickThreshold;
        
        // Reset visual feedback
        // const headerElement = document.querySelector('.media-header') as HTMLElement;
        const backgroundElement = document.querySelector('.media-info-background') as HTMLElement;
        
        if (backgroundElement) {
            backgroundElement.style.transform = '';
            backgroundElement.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';
        }
        
        if (backgroundElement) {
            backgroundElement.classList.remove('swiping', 'swipe-left', 'swipe-right');
        }
        
        if (isDrag) {
            // Handle as drag
            const swipeDistance = Math.abs(this.horizontalDragOffset);
            const swipeVelocity = this.calculateHorizontalVelocity();
            const isRightSwipe = this.horizontalDragOffset > 0;
            
            // Check if swipe should trigger skip
            const shouldSkip = swipeDistance > this.swipeThreshold || swipeVelocity > this.swipeVelocityThreshold;
            
            if (shouldSkip) {
                if (isRightSwipe) {
                    this.previous();
                } else {
                    this.next();
                }
            }
            
            // Prevent the click event from firing after a drag
            event.preventDefault();
            event.stopPropagation();
        }
        // For clicks, let the click handler deal with it
        
        // Reset values
        this.horizontalDragOffset = 0;
        this.currentX = 0;
        this.headerHasMoved = false;
        
        // Remove document listeners
        document.removeEventListener('mousemove', this.boundHeaderMouseMove);
        document.removeEventListener('mouseup', this.boundHeaderMouseUp);
    }

    onHeaderClick(event: MouseEvent): void {
        console.log('Header click:', {
            visibility: this.visibility_status,
            headerHasMoved: this.headerHasMoved,
            target: (event.target as HTMLElement).className,
            isHorizontalSwiping: this.isHorizontalSwiping
        });

        // Check if click is on a quick action button first
        const target = event.target as HTMLElement;
        const isQuickActionButton = target.closest('.player-status') || 
                                   target.closest('.queue-container') || 
                                   target.classList.contains('player-status') || 
                                   target.classList.contains('queue');
        
        if (isQuickActionButton) {
            console.log('Quick action button clicked, ignoring header click');
            // Don't handle header click for quick action buttons
            event.stopPropagation();
            return;
        }

        // For reduced mode, always allow clicks to open (ignore headerHasMoved for simple taps)
        if (this.visibility_status === 'reduced') {
            this.toggle_visibility();
            return;
        }

        // For visible mode, only handle if we haven't moved (to avoid clicks after drags)
        if (this.visibility_status === 'visible' && !this.headerHasMoved) {
            this.toggle_visibility();
        }
    }

    private calculateHorizontalVelocity(): number {
        const timeDelta = Date.now() - this.lastSwipeTime;
        if (timeDelta === 0) return 0;
        
        const distance = Math.abs(this.horizontalDragOffset);
        return distance / timeDelta;
    }

    // Bound methods for horizontal swipe event listeners
    private boundHeaderMouseMove = (event: MouseEvent) => this.onHeaderMouseMove(event);
    private boundHeaderMouseUp = (event: MouseEvent) => this.onHeaderMouseUp(event);

    // Apple-style seek bar event handlers
    onSeekBarMouseDown(event: MouseEvent): void {
        if (this.is_seekbar_disabled) return;
        
        event.preventDefault();
        event.stopPropagation();
        
        this.startSeekBarDrag(event.clientX, this.audio_current_time);
        
        // Add global mouse event listeners
        document.addEventListener('mousemove', this.boundSeekBarMouseMove);
        document.addEventListener('mouseup', this.boundSeekBarMouseUp);
    }

    onSeekBarTouchStart(event: TouchEvent): void {
        if (this.is_seekbar_disabled) return;
        
        event.preventDefault();
        event.stopPropagation();
        
        const touch = event.touches[0];
        this.startSeekBarDrag(touch.clientX, this.audio_current_time);
        
        // Add global touch event listeners
        document.addEventListener('touchmove', this.boundSeekBarTouchMove, { passive: false });
        document.addEventListener('touchend', this.boundSeekBarTouchEnd);
    }

    private startSeekBarDrag(startX: number, currentValue: number): void {
        this.isSeekBarDragging = true;
        this.seekBarStartX = startX;
        this.seekBarStartValue = currentValue;
        this.seekBarPreviewValue = currentValue;
        this.seekBarInitialTouch = true;
    }

    private onSeekBarMouseMove(event: MouseEvent): void {
        if (!this.isSeekBarDragging) return;
        
        event.preventDefault();
        this.updateSeekBarPosition(event.clientX);
    }

    private onSeekBarTouchMove(event: TouchEvent): void {
        if (!this.isSeekBarDragging) return;
        
        event.preventDefault();
        const touch = event.touches[0];
        this.updateSeekBarPosition(touch.clientX);
    }

    private updateSeekBarPosition(currentX: number): void {
        const deltaX = currentX - this.seekBarStartX; // Right = positive
        const sensitivity = this.seekBarDragSensitivity;
        
        // Calculate new position based on horizontal displacement
        const deltaSeconds = deltaX / sensitivity; // Convert pixels to seconds
        let newValue = this.seekBarStartValue + deltaSeconds;
        
        // Clamp to valid range
        newValue = Math.max(0, Math.min(newValue, this.audio_duration));
        
        this.seekBarPreviewValue = newValue;
    }

    private onSeekBarMouseUp(event: MouseEvent): void {
        if (!this.isSeekBarDragging) return;
        
        event.preventDefault();
        this.endSeekBarDrag();
        
        // Remove global mouse event listeners
        document.removeEventListener('mousemove', this.boundSeekBarMouseMove);
        document.removeEventListener('mouseup', this.boundSeekBarMouseUp);
    }

    private onSeekBarTouchEnd(event: TouchEvent): void {
        if (!this.isSeekBarDragging) return;
        
        event.preventDefault();
        this.endSeekBarDrag();
        
        // Remove global touch event listeners
        document.removeEventListener('touchmove', this.boundSeekBarTouchMove);
        document.removeEventListener('touchend', this.boundSeekBarTouchEnd);
    }

    private endSeekBarDrag(): void {
        if (!this.isSeekBarDragging) return;
        
        // Apply the seek
        this.player.seek_to(this.seekBarPreviewValue);
        
        // Reset drag state
        this.isSeekBarDragging = false;
        this.seekBarInitialTouch = false;
    }

    // Bound methods for seek bar event listeners
    private boundSeekBarMouseMove = (event: MouseEvent) => this.onSeekBarMouseMove(event);
    private boundSeekBarMouseUp = (event: MouseEvent) => this.onSeekBarMouseUp(event);
    private boundSeekBarTouchMove = (event: TouchEvent) => this.onSeekBarTouchMove(event);
    private boundSeekBarTouchEnd = (event: TouchEvent) => this.onSeekBarTouchEnd(event);









    
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
        // if (screen.orientation) {
        //     this._isLandscape = screen.orientation.angle === 90 || screen.orientation.angle === -90 || screen.orientation.angle === 270;
        // }
        // // Method 2: Use window.orientation (older browsers)
        // else if (typeof (window as any).orientation !== 'undefined') {
        //     this._isLandscape = Math.abs((window as any).orientation) === 90;
        // }
        // // Method 3: Fallback using window dimensions
        // else {
        //     this._isLandscape = window.innerWidth > window.innerHeight;
        // }
        this._isLandscape = window.innerWidth > window.innerHeight;
        
        // console.log('📱 Orientation changed:', this._isLandscape ? 'Landscape' : 'Portrait');
        
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

    public minimum_hls_level: number = 1;
    public total_hls_levels: number = 0;
    public quality_selection_open: boolean = false;
    public all_qualities: string[] = ['ultra-low', 'low', 'medium', 'high', 'ultra-high', 'auto',];
    get available_qualities(): string[] {
        const qualities = ['ultra-low', 'low', 'medium', 'high', 'ultra-high'];
        let available = qualities.slice(this.minimum_hls_level, this.total_hls_levels);
        available.push('auto');
        return available;
    }
    get current_quality(): string {
        // switch(this.player.audio_quality) {
        //     case -1: return 'auto';
        //     case 0: return 'ultra-low';
        //     case 1: return 'low';
        //     case 2: return 'medium';
        //     case 3: return 'high';
        //     case 4: return 'ultra-high';
        //     default: return 'unknown';
        // }
        return 'unknown';
    }
    set_quality(quality: string): void {
        // this.quality_selection_open = false;
        // if(quality === 'auto') {
        //     this.player.audio_quality = -1;
        //     return;
        // }
        // this.player.audio_quality = this.all_qualities.indexOf(quality);
    }

    is_song_in_playlist(song_data: Song_Data | null): boolean {
        if (!song_data) return false;
        return Array.from(this.media.get_playlists_containing_song(this.media.bare_song_key(song_data.id))).filter((playlist) => {
            return playlist !== '#recently_played'
        }).length > 0;
    }
}

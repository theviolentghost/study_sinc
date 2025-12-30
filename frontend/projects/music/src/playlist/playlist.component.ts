import { Component, HostListener, ViewChild, ElementRef, OnInit, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { MusicPlayerService } from '../../music.player.service';
import { DownloadQuality, MusicMediaService, Song_Playlist_Image, Song_Source } from '../../music.media.service';
import { PlaylistsService } from '../../playlists.service';
import { Song_Data, Song_Identifier } from '../../music.media.service';
import { QuickActionService } from '../../quick.action.service';
import { HotActionService } from '../../hot.action.service';
import { SettingsService } from '../../settings.service';
import { NotificationService } from '../../notification.service';
import { LoadingService } from '../../loading.service';
import { ProgressiveLoadDirective } from '../../progressive.image.loader.directive';
import { cover } from 'three/src/extras/TextureUtils.js';

@Component({
    selector: 'app-playlist',
    imports: [CommonModule, ProgressiveLoadDirective],
    templateUrl: './playlist.component.html',
    styleUrl: './playlist.component.css',
    standalone: true
})
export class PlaylistComponent implements OnInit, AfterViewInit, OnDestroy {
    @ViewChild('resultVideos', { static: false }) result_videos_ref!: ElementRef<HTMLElement>;
    @ViewChild('searchInput', { static: false }) search_input_ref!: ElementRef<HTMLInputElement>;

    loaded: boolean = true;
    search_query: string = '';
    filtered_videos: (Song_Data | null)[] = [];
    song_images: Song_Playlist_Image[] = [];
    use_playlist_color_for_main: boolean = true;
    is_actions_sticky: boolean = false;

    order_type: 'recent_to_old' | 'old_to_recent' | 'alphabetical' = 'recent_to_old';
    scrollbar_text: string = '';

    // Notification properties
    notification_message: string = '';
    notification_visible: boolean = false;

    // Custom scrollbar properties
    scrollbar_visible: boolean = false;
    scrollbar_dragging: boolean = false;
    scrollbar_transform: string = 'translateX(12px) translateZ(0)';
    private scrollbar_drag_start_y: number = 0;
    private scrollbar_drag_start_scroll: number = 0;
    private scrollbar_hide_timeout?: number;
    private scrollbar_update_frame?: number;
    private last_scrollbar_y: number = 0;
    
    // Aggressive text update throttling (250ms = 4 times per second)
    private scrollbar_text_update_interval: number = 250;
    private last_text_update_time: number = 0;
    private pending_text_update: boolean = false;
    private text_update_timeout?: number;

    get prefers_shuffle_play_over_dj_play(): boolean {
        return this.settings.prefers_shuffle_play_over_dj_play;
    }

    get shuffle(): boolean {
        return this.player.shuffle;
    }

    public toggle_shuffle(): void {
        this.player.shuffle = !this.player.shuffle;
    }

    ngOnInit(): void {
        // Component initialization
        // this.loaded = false;
        this.loading_service.loading = true;
        this.player.playlist_changed.subscribe(() => {
            this.update_main_color();
        });
        this.update_main_color();
        this.player.clear_playlist_color.subscribe(() => {
            // check to see if the navigation url is the same as this playlist
            // if(this.router.url.includes('/playlist/') && this.playlist_identifier) return;
            document.documentElement.style.setProperty('--color-primary', 'var(--default-primary-color)');
        });

        // Subscribe to notification service
        // this.notification_service.notification$.subscribe((notification: Notification) => {
        //     this.notification_message = notification.message;
        //     this.notification_visible = notification.visible;
        // });
        Promise.resolve().then(async () => {
            for(let image_key of this.playlist_identifier?.images || []) {
                const song_key = image_key.song_key;
                const song_data = await this.media.get_song_from_indexDB(song_key);
                this.song_images.push({
                    low: song_data.url?.artwork?.low,
                    high: song_data.url?.artwork?.high,
                    blob: song_data.download_artwork_blob
                });
            }
        });
    }

    ngAfterViewInit(): void {
        // Auto-scroll to hide search-filter when component loads
        // this.auto_scroll_past_search_filter();
        // this.loaded = true;
        this.loading_service.loading = false;

        this.update_main_color();
        this.update_container_height();
    }

    update_main_color(): void {
        if(this.use_playlist_color_for_main) {
            // console.log(this.playlist_identifier, this.player.playlist_identifier);
            // if(this.playlist_identifier?.id !== this.player?.playlist_identifier?.id) return;
            const color = this.get_playlist_primary_color();
            if( color.trim() !== 'var(--color-primary)' ) {
                document.documentElement.style.setProperty('--color-primary', color);
            }
        }
    }

    ngOnDestroy(): void {
        // Reset primary color on destroy
        document.documentElement.style.setProperty('--color-primary', 'var(--default-primary-color)');
        
        // Cleanup scrollbar resources
        if (this.scrollbar_hide_timeout) {
            clearTimeout(this.scrollbar_hide_timeout);
        }
        if (this.scrollbar_update_frame) {
            cancelAnimationFrame(this.scrollbar_update_frame);
        }
        if (this.text_update_timeout) {
            clearTimeout(this.text_update_timeout);
        }
    }

    private auto_scroll_past_search_filter(smooth: boolean = false): void {
        // Wait for next tick to ensure DOM is fully rendered
        setTimeout(() => {
            this.update_main_color();
            if (this.result_videos_ref?.nativeElement) {
                // Find the search-filter element to get its height
                const host_element = this.result_videos_ref.nativeElement.closest('app-playlist');
                const search_filter = host_element?.querySelector('.search-filter') as HTMLElement;
                
                if (search_filter) {
                    // Get the height of the search-filter including margins
                    const search_filter_height = search_filter.offsetHeight;
                    const computed_style = getComputedStyle(search_filter);
                    const margin_top = parseInt(computed_style.marginTop) || 0;
                    const margin_bottom = parseInt(computed_style.marginBottom) || 0;
                    const total_height = search_filter_height + margin_top + margin_bottom;
                    
                    // Scroll the host element (component container) to hide the search-filter
                    const scroll_container = host_element as HTMLElement;
                    if (scroll_container && scroll_container.scrollTo) {
                        scroll_container.scrollTo({
                            top: total_height, 
                            behavior: smooth ? 'smooth' : 'instant'
                        });
                    }
                } else {
                    // Fallback: scroll a fixed amount if search-filter not found
                    const scroll_container = host_element as HTMLElement;
                    if (scroll_container && scroll_container.scrollTo) {
                        scroll_container.scrollTo({
                            top: 52, // Approximate height
                            behavior: smooth ? 'smooth' : 'instant' 
                        });
                    }
                }
            }
        }, 100); // Small delay to ensure DOM is ready
    }

    // Sticky header state
    is_header_visible = true;

    videos: (Song_Data | null)[] = [];
    loaded_videos: Map<number, Song_Data | null> = new Map();
    
    // Cached sorted videos to avoid re-sorting on every render
    private sorted_videos_cache: (Song_Data | null)[] = [];
    private last_sort_method: string = '';
    private last_source_length: number = 0;
    private cache_timestamp: number = 0;
    private last_cache_timestamp: number = 0;
    
    // Virtual scrolling properties
    significant_change_size = 3; // how many elements you have to scroll past before loading new ones
    visible_start_index = 0;
    visible_end_index = 20; // Show 20 items initially
    buffer_size = 15; // Load extra items after visible area
    item_height = 60; // Height of each playlist item in pixels
    container_height = 1000; // Height of scrollable container

    swiping_video: string = '';
    swiping_video_data: Song_Data | null = null;
    swipe_state: 'closed' | 'open' | 'dragging' = 'closed';
    swipe_start_x: number = 0;
    swipe_delta_x: number = 0;
    swipe_x: number = 0;
    idle_swipe_open_size: number = 160; 
    delete_swipe_open_size: number = 245; // distance to travel before deleting
    dont_play: boolean = false; 
    get swipe_width(): number {
        return Math.abs(this.swipe_x);
    }
    swipe_threshold: number = 10; 

    // Add mouse tracking properties
    is_mouse_down = false;

    // Enhanced gesture detection properties
    private gesture_start_x = 0;
    private gesture_start_y = 0;
    private gesture_current_x = 0;
    private gesture_current_y = 0;
    private gesture_threshold = 10;
    private gesture_type: 'none' | 'vertical' | 'horizontal' | 'tap' | 'hold' = 'none';
    private gesture_start_time = 0;
    private tap_timeout = 200;
    private hold_timeout = 330; // Time to trigger hold gesture 
    private is_gesture_active = false;
    private hold_timer: any = null;
    private hold_progress = 0;
    private hold_animation_frame: any = null;

    video_key(song_data: Song_Data | null | undefined): string {
        if (!song_data) return '';
        return this.media.bare_song_key(song_data.id);
    }
    
    video_on_swipe_start(event: TouchEvent | MouseEvent, video: Song_Data | null): void {
        let clientX: number, clientY: number;
        
        if (event instanceof TouchEvent) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
            this.is_mouse_down = true;
        }

        // Initialize gesture detection
        this.gesture_start_x = clientX;
        this.gesture_start_y = clientY;
        this.gesture_current_x = clientX;
        this.gesture_current_y = clientY;
        this.gesture_type = 'none';
        this.gesture_start_time = Date.now();
        this.is_gesture_active = true;
        this.hold_progress = 0;

        // Store which video we're potentially swiping
        const new_song_key = this.video_key(video);
        if(this.swiping_video !== new_song_key) {
            this.swipe_start_x = clientX;
            this.swipe_x = 0;
        } else {
            // same video 
            if(this.swipe_state === 'open') {
                this.swipe_start_x = clientX + this.idle_swipe_open_size; // Keep it open
            } else {
                this.swipe_start_x = clientX;
                this.swipe_x = 0;
            }
        }
        this.swiping_video = new_song_key;
        this.swiping_video_data = video;

        // Start hold timer
        this.start_hold_timer(video);

        // Don't prevent default yet - let the gesture detection decide
        event.stopPropagation();
    }
    video_on_swipe_move(event: TouchEvent | MouseEvent): void {
        if (!this.is_gesture_active) return;
        
        let clientX: number, clientY: number;
        
        if (event instanceof TouchEvent) {
            clientX = event.touches[0].clientX;
            clientY = event.touches[0].clientY;
        } else {
            if (!this.is_mouse_down) return;
            clientX = event.clientX;
            clientY = event.clientY;
        }
        this.queued_to_next = false;

        this.gesture_current_x = clientX;
        this.gesture_current_y = clientY;

        const deltaX = Math.abs(clientX - this.gesture_start_x);
        const deltaY = Math.abs(clientY - this.gesture_start_y);
        const totalDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        // If user moves too much, cancel hold gesture
        if (totalDistance > this.gesture_threshold && this.gesture_type === 'none') {
            this.cancel_hold_timer();
            
            if (deltaX > deltaY * 1.5) {
                // Horizontal gesture (swipe for actions)
                this.gesture_type = 'horizontal';
                this.swipe_delta_x = clientX - this.swipe_start_x;
                this.swipe_x = Math.min(0, this.swipe_delta_x); // Limit swipe to left
                this.swipe_state = 'dragging';
            } else if (deltaY > deltaX * 1.5) {
                // Vertical gesture (scrolling)
                this.gesture_type = 'vertical';
            }
        }

        // Handle the gesture based on type
        if (this.gesture_type === 'horizontal') {
            // Handle horizontal swipe for actions
            const swipeDistance = clientX - this.swipe_start_x;
            this.swipe_x = Math.min(0,swipeDistance);
            event.preventDefault();
        } else if (this.gesture_type === 'vertical') {
            // Allow natural scrolling - don't interfere
            this.is_gesture_active = false;
            this.cancel_hold_timer();
            return;
        }

        event.stopPropagation();
    }
    video_on_swipe_end(event: TouchEvent | MouseEvent): void {
        if (!this.is_gesture_active) return;

        let clientX: number, clientY: number;
        
        if (event instanceof TouchEvent) {
            const touch = event.changedTouches[0];
            clientX = touch.clientX;
            clientY = touch.clientY;
        } else {
            clientX = event.clientX;
            clientY = event.clientY;
            this.is_mouse_down = false;
        }

        const deltaX = Math.abs(clientX - this.gesture_start_x);
        const deltaY = Math.abs(clientY - this.gesture_start_y);
        const totalDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const gestureDuration = Date.now() - this.gesture_start_time;

        // Cancel hold timer
        this.cancel_hold_timer();

        // Determine final action
        if (this.gesture_type === 'horizontal') {
            // Handle swipe actions
            const swipeDistance = clientX - this.swipe_start_x;
            if( swipeDistance < -this.delete_swipe_open_size) {
                this.play_delete_animation();
                setTimeout(() => {
                    // delete from video array
                    const index = this.videos.findIndex(v => this.media.bare_song_key(v?.id) === this.swiping_video);
                    if (index !== -1) {
                        this.videos.splice(index, 1);
                    }
                    this.delete_video_from_playlist(this.swiping_video_data);
                    // console.log(index)
                }, 600);
            }
            else if (swipeDistance < -this.idle_swipe_open_size / 2) {
                this.animate_swipe_value(this.swipe_x, -this.idle_swipe_open_size);
                this.swipe_state = 'open';
            } else {
                this.animate_swipe_value(this.swipe_x, 0);
                this.swipe_state = 'closed';
            }
            event.preventDefault();
        } else if (this.gesture_type === 'hold') {
            // Hold gesture completed - handled by timer
            this.swipe_x = 0; // Reset swipe position
            event.preventDefault();
        } else if (this.gesture_type === 'none' && totalDistance < this.gesture_threshold && gestureDuration < this.tap_timeout) {
            // This is a tap - play the song
            this.gesture_type = 'tap';
            if (this.swiping_video_data && !this.queued_to_next) {
                // prevents playing if we just queued to next
                setTimeout(() => this.play(this.swiping_video_data), 50);
            }
        }

        // Reset gesture state
        this.is_gesture_active = false;
        this.gesture_type = 'none';
        this.dont_play = false; 

        event.stopPropagation();
    }

    private queued_to_next: boolean = false;
    private start_hold_timer(video: Song_Data | null): void {
        const startTime = Date.now();
        
        // Start progress animation
        const updateProgress = () => {
            if (!this.is_gesture_active || this.gesture_type !== 'none') {
                this.hold_progress = 0;
                return;
            }
            
            const elapsed = Date.now() - startTime;
            this.hold_progress = Math.min(elapsed / this.hold_timeout, 1) * 100;
            
            if (elapsed >= this.hold_timeout) {
                // Hold gesture completed
                this.gesture_type = 'hold';
                this.swipe_x = 0;
                this.trigger_add_to_next(video);
                this.queued_to_next = true;
                this.hold_progress = 100;
            } else {
                this.hold_animation_frame = requestAnimationFrame(updateProgress);
            }
        };
        
        this.hold_animation_frame = requestAnimationFrame(updateProgress);
    }

    private cancel_hold_timer(): void {
        if (this.hold_timer) {
            clearTimeout(this.hold_timer);
            this.hold_timer = null;
        }
        if (this.hold_animation_frame) {
            cancelAnimationFrame(this.hold_animation_frame);
            this.hold_animation_frame = null;
        }
        this.hold_progress = 0;
    }

    private trigger_add_to_next(video: Song_Data | null): void {
        if (!video) return;
        this.player.add_song_to_play_next(video);
        this.notification_service.info(`Queued "${video.song_name}" to play next`, {stackable: false, dismissTime: 3000, icon: 'add-to-queue.svg'});

        // Trigger success animation
        this.play_add_to_next_animation();
        
        // Reset states
        this.is_gesture_active = false;
        this.gesture_type = 'none';
        this.hold_progress = 0;
    }

    private play_add_to_next_animation(): void {
        // Create a visual feedback animation
        const element = document.querySelector(`[data-video-key="${this.swiping_video}"]`) as HTMLElement;
        if (element) {
            element.classList.add('added-to-next');
            setTimeout(() => {
                element.classList.remove('added-to-next');
            }, 200);
        }
    }

    private play_delete_animation(): void {
        // Create a visual feedback animation for delete
        const element = document.querySelector(`[data-video-key="${this.swiping_video}"]`) as HTMLElement;
        if (element) {
            element.classList.add('delete-animation');
            this.animate_swipe_value(this.swipe_x, -window.innerWidth, 700);
        }
    }

    source_options: Map<Song_Source, string> = new Map([
        ['spotify', "#1cd760"],
        ['youtube', "#ff0033"],
        ['musi', "#ff8843"],
        ['musix', "#ff8843"],
    ]);

    get_source_color(source: Song_Source | undefined): string {
        if( !source ) return 'var(--color-primary)'; // gray color for undefined sources
        return this.source_options.get(source) || 'var(--color-primary)'; // default to gray if source not found
    }

    get_playlist_primary_color(): string {
        if(this.quick_action.playlist_view_color) return this.quick_action.playlist_view_color;
        return this.playlists.selected_playlist_identifier?.colors?.primary || 'var(--color-primary)';
    }

    get_text_contrast_color(bg_color: string): string {
        return this.quick_action.get_contrast_color(bg_color);
    }

    get playlist() {
        return this.playlists.selected_playlist;
    }
    get playlist_identifier() {
        return this.playlists.selected_playlist_identifier;
    }
    is_downloading(video_id: string): boolean {
        return this.media.is_downloading(video_id); 
    }
    video_progress(video_id: string): number {
        return this.media.download_progress(video_id); // return the current download progress
    }
    is_in_download_queue(video_id: string): boolean {
        return this.media.is_in_download_queue(video_id); 
    }

    constructor(
        private playlists: PlaylistsService,
        private route: ActivatedRoute,
        private router: Router,
        private media: MusicMediaService,
        private player: MusicPlayerService,
        public quick_action: QuickActionService,
        public hot_action: HotActionService,
        public settings: SettingsService,
        private notification_service: NotificationService,
        public loading_service: LoadingService
    ) {
        this.route.paramMap.subscribe(async params => {
            const playlist_id = params.get('playlist_id');
            if (playlist_id) {
                // Wait for playlist to load if it's async
                await this.playlists.load_playlist({id: playlist_id, name: '', track_count: 0, default: false, images: [], playlist_type: 'playlist', created_by: 'user', created_at: Date.now()  });
                await this.load_videos();
            } else {
                this.videos = [];
            }
        });

        this.media.song_data_updated.subscribe(song_data => {
            this.update_video(song_data);
        });
    }

    // Fuzzy Search Implementation
    on_search_input(event: Event): void {
        const target = event.target as HTMLInputElement;
        this.search_query = target.value.toLowerCase().trim();
        this.apply_search_filter();
    }

    private apply_search_filter(): void {
        if (!this.search_query) {
            // If no search query, show all videos
            this.filtered_videos = [...this.videos];
        } else {
            // Apply fuzzy search filter
            this.filtered_videos = this.videos.filter(video => {
                if (!video) return false;
                return this.fuzzy_match(video, this.search_query);
            });
        }
    }

    private fuzzy_match(video: Song_Data, query: string): boolean {
        if (!video || !query) return false;

        const searchFields = [
            video.song_name?.toLowerCase() || '',
            video.artists?.[0]?.name?.toLowerCase() || '',
            // Add more fields as needed
            ...(video.artists?.map(artist => artist.name?.toLowerCase() || '') || [])
        ].filter(field => field.length > 0);

        // Check for exact substring matches first (highest priority)
        for (const field of searchFields) {
            if (field.includes(query)) {
                return true;
            }
        }

        // Check for fuzzy matching (allows for typos/partial matches)
        for (const field of searchFields) {
            if (this.calculate_similarity(field, query) >= 0.6) { // 60% similarity threshold
                return true;
            }
        }

        // Check for word-based matching (any word starts with query)
        for (const field of searchFields) {
            const words = field.split(/\s+/);
            for (const word of words) {
                if (word.startsWith(query) || this.calculate_similarity(word, query) >= 0.7) {
                    return true;
                }
            }
        }

        return false;
    }

    private calculate_similarity(str1: string, str2: string): number {
        // Levenshtein distance-based similarity
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;

        if (longer.length === 0) return 1.0;

        const distance = this.levenshtein_distance(longer, shorter);
        return (longer.length - distance) / longer.length;
    }

    private levenshtein_distance(str1: string, str2: string): number {
        const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

        for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

        for (let j = 1; j <= str2.length; j++) {
            for (let i = 1; i <= str1.length; i++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,     // deletion
                    matrix[j - 1][i] + 1,     // insertion
                    matrix[j - 1][i - 1] + cost // substitution
                );
            }
        }

        return matrix[str2.length][str1.length];
    }

    clear_search(): void {
        this.search_query = '';
        if (this.search_input_ref?.nativeElement) {
            this.search_input_ref.nativeElement.value = '';
        }
        this.apply_search_filter();
    }

    get current_song_identifier(): Song_Identifier | null {
        return this.player.current ? this.player.current.id : null;
    }

    get video_identifiers(): Song_Identifier[] {
        return this.playlists.selected_playlist_video_identifiers;
    }

    async load_videos() {
        // Don't load all videos at once, just prepare the array
        this.videos = new Array(this.playlists.selected_playlist_video_identifiers.length).fill(null);
        this.loaded_videos.clear();
        
        // Clear the cache when loading new playlist
        this.sorted_videos_cache = [];
        this.cache_timestamp = 0;
        
        // Load initial batch
        await this.load_videos_in_range(0, this.videos.length);
        
        // Initialize filtered videos
        this.filtered_videos = [...this.videos];
    }

    get visible_videos(): (Song_Data | null)[] {
        // Use filtered videos if search is active, otherwise use regular videos
        const source_videos = this.search_query ? this.filtered_videos : this.videos;
        const playlist = this.playlists.selected_playlist;

        if(!playlist) {
            return [...source_videos].slice(this.visible_start_index, this.visible_end_index);
        }

        const sort_method = playlist.sorting_method || 'recent_to_old';
        
        // Check if we need to re-sort (cache invalidation)
        const needs_resort = 
            this.last_sort_method !== sort_method || 
            this.last_source_length !== source_videos.length ||
            this.sorted_videos_cache.length === 0 ||
            this.cache_timestamp !== this.last_cache_timestamp;

        if (needs_resort) {
            // Create a copy and sort it
            this.sorted_videos_cache = [...source_videos];
            
            this.sorted_videos_cache.sort((a, b) => {
                if (!a || !b) return 0;

                switch (sort_method) {
                    case 'recent_to_old':
                        return (playlist.song_added_timestamps.get(this.media.song_key(b.id)) || 0) - 
                               (playlist.song_added_timestamps.get(this.media.song_key(a.id)) || 0);
                    case 'old_to_recent':
                        return (playlist.song_added_timestamps.get(this.media.song_key(a.id)) || 0) - 
                               (playlist.song_added_timestamps.get(this.media.song_key(b.id)) || 0);
                    case 'title':
                    case 'alphabetical':
                        return this.custom_alpha_sort(a?.song_name || '', b?.song_name || '');
                    case 'artist':
                        return this.custom_alpha_sort(
                            a?.artists?.[0]?.name || '',
                            b?.artists?.[0]?.name || ''
                        );
                    default:
                        return 0;
                }
            });
            
            // Update cache metadata
            this.last_sort_method = sort_method;
            this.last_source_length = source_videos.length;
            this.last_cache_timestamp = this.cache_timestamp;
        }

        // Return only the visible slice for virtual scrolling optimization
        return this.sorted_videos_cache.slice(this.visible_start_index, this.visible_end_index);
    }

    private custom_alpha_sort(a: string, b: string): number {
        const getFirst = (str: string) => str.trim()[0]?.toUpperCase() || '';
        const isAlpha = (char: string) => /^[A-Z]$/.test(char);

        const aFirst = getFirst(a);
        const bFirst = getFirst(b);

        const aIsAlpha = isAlpha(aFirst);
        const bIsAlpha = isAlpha(bFirst);

        if (!aIsAlpha && bIsAlpha) return -1; // a is non-letter, b is letter
        if (aIsAlpha && !bIsAlpha) return 1;  // a is letter, b is non-letter
        // Both are same type, sort normally
        return a.localeCompare(b);
    }

    get padding_top(): string {
        return `${this.visible_start_index * this.item_height}px`;
    }
    get padding_bottom(): string {
        // Use the actual source videos length (filtered or regular)
        const source_videos = this.search_query ? this.filtered_videos : this.videos;
        const remaining_items = source_videos.length - this.visible_end_index;
        return `${remaining_items * this.item_height}px`;
    }

    async load_videos_in_range(start: number, end: number) {
        const promises = [];
        const initial_loaded_count = this.loaded_videos.size;
        
        for (let i = start; i < end; i++) {
            if (!this.loaded_videos.has(i) && i < this.playlists.selected_playlist_video_identifiers.length) {
                const video_id = this.playlists.selected_playlist_video_identifiers[i];
                promises.push(
                    this.media.get_song_from_indexDB(this.media.song_key(video_id))
                        .then(video => {
                            this.loaded_videos.set(i, video);
                            this.videos[i] = video;
                        })
                );
            }
        }
        
        await Promise.all(promises);
        
        // Only invalidate cache if we actually loaded new videos
        if (this.loaded_videos.size > initial_loaded_count) {
            this.cache_timestamp = Date.now();
        }
        
        // Update filtered videos after loading new data
        this.apply_search_filter();
    }

    update_video(video: Song_Data | null) {
        const index = this.videos.findIndex(v => v?.id.video_id === video?.id.video_id);
        this.loaded_videos.set(index, video);
        this.videos[index] = video;
    }

    private update_container_height(): void {
        // if (this.result_videos_ref?.nativeElement) {
            // const element = this.result_videos_ref.nativeElement;
            this.container_height = window.innerHeight || 1000; // Fallback to 1000 if not available
        // }
    }

    private check_actions_sticky(): void {
        const host_element = this.result_videos_ref?.nativeElement?.closest('app-playlist') as HTMLElement;
        const actions_element = host_element?.querySelector('.actions') as HTMLElement;
        const result_videos_element = this.result_videos_ref?.nativeElement;
        
        if (!actions_element || !result_videos_element || !host_element) {
            return;
        }

        // Get bounding rectangles
        const actions_rect = actions_element.getBoundingClientRect();
        const result_videos_rect = result_videos_element.getBoundingClientRect();
        const host_rect = host_element.getBoundingClientRect();

        // Check if actions is overlapping with result-videos
        // Actions is sticky when its bottom edge is touching or below the top of result-videos
        // and it's at the top of the viewport (or close to it)
        const is_overlapping = actions_rect.bottom >= result_videos_rect.top && 
                              actions_rect.top <= host_rect.top + 50; // 50px threshold for "stuck at top"

        // Update state and DOM only if changed
        if (this.is_actions_sticky !== is_overlapping) {
            this.is_actions_sticky = is_overlapping;
            
            if (this.is_actions_sticky) {
                actions_element.classList.add('sticky');
            } else {
                actions_element.classList.remove('sticky');
            }
        }
    }
        

    @HostListener('scroll', ['$event'])
    on_scroll(event: Event) {
        const target = event.target as HTMLElement;
        const scrollTop = target.scrollTop;
        
        // Update scrollbar position (throttled with RAF)
        if (!this.scrollbar_dragging && !this.scrollbar_update_frame) {
            this.scrollbar_update_frame = requestAnimationFrame(() => {
                this.update_scrollbar_position(target);
                this.scrollbar_update_frame = undefined;
            });
        }
        
        // Update container height in case of resize
        this.update_container_height();
        
        // Check if .actions is sticky (overlapping with .result-videos)
        this.check_actions_sticky();

        const cover_element = document.querySelector('.cover') as HTMLElement;
        if (cover_element) {
            cover_element.style.width = `calc(80% - ${target.scrollTop}px)`;
            cover_element.style.opacity = `${Math.min(1, Math.max(0, 1.2 - target.scrollTop / 160))}`;
            cover_element.style.transform = `translateY(${target.scrollTop / 6}px)`;
        }
        // Check header visibility - header has height: 50vh + padding + margins
        // Approximate total height considering 50vh + space-7 padding + space-6 margin
        const viewport_height = window.innerHeight;
        const header_height = Math.max(500, viewport_height * 0.5 + 120); // 50vh + ~120px for padding/margins
        const was_header_visible = this.is_header_visible;
        this.is_header_visible = scrollTop < header_height;
        
        // Calculate visible range based on scroll position
        const new_start = Math.floor((scrollTop - header_height) / this.item_height);
        const new_end = Math.min(
            new_start + Math.ceil((this.container_height + header_height) / this.item_height),
            this.videos.length
        );

        // console.log('new end', new_end)

        const buffered_start = Math.max(0, new_start - this.buffer_size);
        const buffered_end = Math.min(this.videos.length, new_end + this.buffer_size);

        // console.log(`ScrollTop: ${scrollTop}, New Range: ${new_start}-${new_end}, Buffered Range: ${buffered_start}-${buffered_end}`);

        if (Math.abs(buffered_start - this.visible_start_index) > this.significant_change_size || 
            Math.abs(buffered_end - this.visible_end_index) > this.significant_change_size) {
            
            this.visible_start_index = buffered_start;
            this.visible_end_index = buffered_end;
            
            // Load videos in new range
            this.load_videos_in_range(buffered_start, buffered_end);
        }
    }

    @HostListener('window:resize', ['$event'])
    on_window_resize(event?: Event): void {
        this.update_container_height();
    }
    
    private update_scrollbar_position(scroll_container: HTMLElement): void {
        const scroll_height = scroll_container.scrollHeight - scroll_container.clientHeight;
        if (scroll_height <= 0) return;
        
        const scroll_percentage = scroll_container.scrollTop / scroll_height;
        
        // Map to viewport range (10% - 90%)
        const host_element = scroll_container.closest('app-playlist') as HTMLElement;
        if (!host_element) return;
        const viewport_height = host_element.clientHeight;
        const range_start = viewport_height * 0.0 + 40;
        const range_end = viewport_height * 1.0 - 40;
        const scrollbar_y = range_start + (scroll_percentage * (range_end - range_start));
        
        // Always update position and show scrollbar immediately
        this.last_scrollbar_y = scrollbar_y;
        this.scrollbar_transform = `translateX(12px) translateY(${scrollbar_y}px) translateZ(0)`;
        this.scrollbar_visible = true;
        
        // Throttle text updates to 4 times per second (250ms)
        const now = Date.now();
        const time_since_last_update = now - this.last_text_update_time;
        
        if (time_since_last_update >= this.scrollbar_text_update_interval) {
            // Enough time has passed, update immediately
            this.update_scrollbar_text();
            this.last_text_update_time = now;
            this.pending_text_update = false;
        } else if (!this.pending_text_update) {
            // Schedule an update for later
            this.pending_text_update = true;
            const delay = this.scrollbar_text_update_interval - time_since_last_update;
            
            if (this.text_update_timeout) {
                clearTimeout(this.text_update_timeout);
            }
            
            this.text_update_timeout = window.setTimeout(() => {
                this.update_scrollbar_text();
                this.last_text_update_time = Date.now();
                this.pending_text_update = false;
            }, delay);
        }
        
        this.schedule_scrollbar_hide();
    }
    
    private update_scrollbar_text(): void {
        if (!this.result_videos_ref) {
            this.scrollbar_text = '';
            return;
        }
        
        const video_elements = this.result_videos_ref.nativeElement.querySelectorAll('.result.video');
        if (video_elements.length === 0) {
            this.scrollbar_text = '';
            return;
        }
        
        // Find closest element to scrollbar position (bidirectional search)
        const scrollbar_y = this.last_scrollbar_y;
        let closest_index = -1;
        let closest_distance = Infinity;
        
        // Binary search for approximate starting point
        let left = 0;
        let right = video_elements.length - 1;
        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const rect = video_elements[mid].getBoundingClientRect();
            const center_y = rect.top + rect.height / 2;
            
            if (center_y < scrollbar_y) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        
        // Check nearby elements (limited radius)
        const start_index = Math.max(0, Math.min(left, video_elements.length - 1));
        const max_radius = 20;
        
        for (let offset = 0; offset <= max_radius; offset++) {
            // Check forward
            const forward_index = start_index + offset;
            if (forward_index < video_elements.length) {
                const rect = video_elements[forward_index].getBoundingClientRect();
                const distance = Math.abs((rect.top + rect.height / 2) - scrollbar_y);
                if (distance < closest_distance) {
                    closest_distance = distance;
                    closest_index = forward_index;
                }
            }
            
            // Check backward
            if (offset > 0) {
                const backward_index = start_index - offset;
                if (backward_index >= 0) {
                    const rect = video_elements[backward_index].getBoundingClientRect();
                    const distance = Math.abs((rect.top + rect.height / 2) - scrollbar_y);
                    if (distance < closest_distance) {
                        closest_distance = distance;
                        closest_index = backward_index;
                    }
                }
            }
        }
        
        if (closest_index === -1 || closest_index >= this.visible_videos.length) {
            this.scrollbar_text = '';
            return;
        }
        
        const current_video = this.visible_videos[closest_index];
        if (!current_video) {
            this.scrollbar_text = '';
            return;
        }
        
        // Update text based on sorting method
        const sorting_method = this.playlists.selected_playlist?.sorting_method;
        switch(sorting_method) {
            case 'alphabetical':
            case 'title':
                const first_letter = current_video.song_name?.[0]?.toUpperCase() || '';
                const is_letter = /^[A-Z]$/i.test(first_letter);
                this.scrollbar_text = is_letter ? `'${first_letter}'` : (first_letter ? `'#'` : '');
                break;
            case 'artist':
                const artist_letter = current_video.artists?.[0]?.name?.[0]?.toUpperCase() || '';
                const is_artist_letter = /^[A-Z]$/i.test(artist_letter);
                this.scrollbar_text = is_artist_letter ? `'${artist_letter}'` : (artist_letter ? `'#'` : '');
                break;
            case 'old_to_recent':
            case 'recent_to_old':
            default:
                // Calculate the actual song number in the full sorted list
                // const actual_index = this.visible_start_index + closest_index;
                // this.scrollbar_text = `'${actual_index + 1}'`;
                const video = this.visible_videos[closest_index];
                if(video) {
                    // get date and return MM YYYY format
                    const added_timestamp = this.playlists.selected_playlist?.song_added_timestamps.get(this.media.song_key(video.id)) || 0;
                    const date = new Date(added_timestamp);
                    const month = date.toLocaleString('default', { month: 'short' });
                    const year = date.getFullYear();
                    this.scrollbar_text = `'${month} ${year}'`;
                }
                break;
        }
    }
    
    private schedule_scrollbar_hide(): void {
        if (this.scrollbar_hide_timeout) {
            clearTimeout(this.scrollbar_hide_timeout);
        }
        
        this.scrollbar_hide_timeout = window.setTimeout(() => {
            this.scrollbar_visible = false;
            setTimeout(() => {
                this.scrollbar_text = '';
            }, 300); // Clear text after fade-out
        }, 850);
    }

    scrollbar_on_drag_start(event: MouseEvent | TouchEvent): void {
        event.preventDefault();
        event.stopPropagation();
        
        this.scrollbar_dragging = true;
        const client_y = event instanceof MouseEvent ? event.clientY : event.touches[0].clientY;
        this.scrollbar_drag_start_y = client_y;
        
        const host_element = this.result_videos_ref.nativeElement.closest('app-playlist') as HTMLElement;
        if (host_element) {
            this.scrollbar_drag_start_scroll = host_element.scrollTop;
        }
        
        if (this.scrollbar_hide_timeout) {
            clearTimeout(this.scrollbar_hide_timeout);
        }
        
        // Add global listeners
        document.addEventListener('mousemove', this.scrollbar_on_drag_move_bound);
        document.addEventListener('mouseup', this.scrollbar_on_drag_end_bound);
        document.addEventListener('touchmove', this.scrollbar_on_drag_move_bound, { passive: false });
        document.addEventListener('touchend', this.scrollbar_on_drag_end_bound);
        
        document.body.style.userSelect = 'none';
    }
    
    private scrollbar_on_drag_move_bound = this.scrollbar_on_drag_move.bind(this);
    private scrollbar_on_drag_end_bound = this.scrollbar_on_drag_end.bind(this);
    
    scrollbar_on_drag_move(event: MouseEvent | TouchEvent): void {
        if (!this.scrollbar_dragging || !this.result_videos_ref) return;
        
        event.preventDefault();
        
        const client_y = event instanceof MouseEvent ? event.clientY : event.touches[0].clientY;
        const host_element = this.result_videos_ref.nativeElement.closest('app-playlist') as HTMLElement;
        if (!host_element) return;
        
        // Calculate delta
        const delta_y = client_y - this.scrollbar_drag_start_y;
        
        // Calculate scroll position
        // const viewport_height = window.innerHeight;
        const viewport_height = host_element.clientHeight;
        const range_start = viewport_height * 0.0 + 40;
        const range_end = viewport_height * 1.0 - 40;
        const range_height = range_end - range_start;
        
        const scroll_height = host_element.scrollHeight - host_element.clientHeight;
        const scroll_delta = (delta_y / range_height) * scroll_height;
        
        host_element.scrollTop = this.scrollbar_drag_start_scroll + scroll_delta;
        
        // Update scrollbar position immediately
        const new_scrollbar_y = range_start + ((host_element.scrollTop / scroll_height) * range_height);
        this.last_scrollbar_y = new_scrollbar_y;
        this.scrollbar_transform = `translateX(12px) translateY(${new_scrollbar_y}px) translateZ(0)`;
        
        // During drag, update text more frequently but still throttled (every 100ms instead of 250ms)
        const now = Date.now();
        const drag_throttle_interval = 100; // Faster during drag for better UX
        
        if (now - this.last_text_update_time >= drag_throttle_interval) {
            this.update_scrollbar_text();
            this.last_text_update_time = now;
        }
    }
    
    scrollbar_on_drag_end(event: MouseEvent | TouchEvent): void {
        if (!this.scrollbar_dragging) return;
        
        this.scrollbar_dragging = false;
        
        if (this.scrollbar_update_frame) {
            cancelAnimationFrame(this.scrollbar_update_frame);
            this.scrollbar_update_frame = undefined;
        }
        
        // Remove global listeners
        document.removeEventListener('mousemove', this.scrollbar_on_drag_move_bound);
        document.removeEventListener('mouseup', this.scrollbar_on_drag_end_bound);
        document.removeEventListener('touchmove', this.scrollbar_on_drag_move_bound);
        document.removeEventListener('touchend', this.scrollbar_on_drag_end_bound);
        
        document.body.style.userSelect = '';
        
        this.update_scrollbar_text();
        this.schedule_scrollbar_hide();
    }
    
    // ==================== END CUSTOM SCROLLBAR METHODS ====================

    async play(track_data: Song_Data | null) {
        if (!track_data) return;
        if(this.dont_play) return;
        
        this.player.open_player.emit();

        this.player.media_controller.playlist_manager.current_song_key = this.media.song_key(track_data.id);
        await this.player.load_playlist(this.playlists.selected_playlist_identifier, this.playlists.selected_playlist, false);
        this.player.load_and_play_track(track_data);
        this.player.remove_song_from_playlist_queue(this.media.song_key(track_data.id));
    }

    public ms_to_time(ms: number, format: string = 'concise'): string {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        switch(format) {
            case 'concise':
                if (hours > 0) {
                    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                } else {
                    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
                }
            case 'verbose':
                const parts = [];
                if (hours > 0) parts.push(`${hours} hr`);
                if (minutes > 0) parts.push(`${minutes} min`);
                if (seconds > 0 || parts.length === 0) parts.push(`${seconds} sec`);
                return parts.join(' ');
            case 'date':
                // return in Sep 12, 2023 format
                const date = new Date(ms);
                return `${date.toLocaleString('default', { month: 'short' })} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
            default:
                return '';
        }
    }

    get_bare_song_key(identifier: Song_Identifier | null | undefined): string {
        if (!identifier) return '';
        return this.media.bare_song_key(identifier);
    }

    get is_current_playlist_playing(): boolean {
        // Check if the current playlist is loaded in the player and is playing
        return this.player.playlist_identifier?.id === this.playlists.selected_playlist_identifier?.id &&
               this.player.player_status === 'playing';
    }

    get playlist_play_pause_icon(): string {
        return this.is_current_playlist_playing ? 'player-pause' : 'player-play';
    }

    public async play_playlist (): Promise<void> {
        if(!this.playlists.selected_playlist) return;
        if(this.playlists.selected_playlist.songs.size === 0) return;

        // Check if this playlist is already loaded and playing/paused
        if (this.player.playlist_identifier?.id === this.playlists.selected_playlist_identifier?.id) {
            // Same playlist is loaded, toggle play/pause
            if (this.player.player_status === 'playing') {
                this.player.pause();
            } else {
                this.player.play();
            }
        } else {
            // Different playlist or no playlist loaded, load and play
            this.player.open_player.emit();
            await this.player.load_playlist(this.playlists.selected_playlist_identifier, this.playlists.selected_playlist, false, true);
            this.player.playlist_changed.emit();
            // this.player.play();
        }
    }

    dj_play(): void {

    }

    close(to_top: boolean = false): void {
        if(to_top) {
            // const host_element = this.result_videos_ref.nativeElement.closest('app-playlist') as HTMLElement;
            // if (host_element && host_element.scrollTo) {
            //     host_element.scrollTo({
            //         top: 0,
            //         behavior: 'smooth'
            //     });
            // }
            this.auto_scroll_past_search_filter(true);
            return;
        }
        this.router.navigate(['/playlists'], { replaceUrl: true });
    }

    change_color(): void {
        this.quick_action.quick_action_open = true;
        this.quick_action.action = 'pick_playlist_color';
    }

    redirect_to_search(): void {
        this.router.navigate(['/searches']);
    }

    animateValue(
        from: number, 
        to: number, 
        duration: number, 
        easing: (t: number) => number = this.linear
    ): BehaviorSubject<number> {
        const subject = new BehaviorSubject<number>(from);
        const startTime = Date.now();
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easedProgress = easing(progress);
            const currentValue = from + (to - from) * easedProgress;
            
            subject.next(currentValue);
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                subject.complete();
            }
        };
        
        requestAnimationFrame(animate);
        return subject;
    }
    
    // Easing functions
    easeOutCubic(t: number): number {
        return 1 - Math.pow(1 - t, 3);
    }

    linear(t: number): number {
        return t;
    }

    animate_swipe_value(from: number, to: number, time: number = 125): void {
        this.animateValue(from, to, time).subscribe(value => {
            this.swipe_x = value;
        });
    }

    delete_video_from_playlist(video: Song_Data | null): void {
        if (!video) return;

        this.playlists.remove_song_from_playlist(video, this.playlists.selected_playlist_identifier, this.playlists.selected_playlist);
        
        // Reset swipe state
        this.swipe_x = 0;
        this.swipe_state = 'closed';
        
        // Optionally, you can show a confirmation or feedback message
        console.log(`Video ${video.song_name} removed from playlist.`);
    }

    get_playlist_download_icon(): string {
        if (this.media.is_song_in_playlist_download_queue(this.playlists.selected_playlist_identifier)) {
            return 'loader.svg'; 
        }

        return 'download.svg'; 
    }

    how_many_songs_in_playlist_download_queue(): number {
        return this.media.how_many_songs_in_playlist_download_queue(this.playlists.selected_playlist_identifier);
    }

    request_download_playlist(): void {
        this.quick_action.quick_action_open = true;
        this.quick_action.action = 'download_playlist';
    }

    open_video_options(video: Song_Data | null): void {
        if (!video) return;
        this.dont_play = true;

        this.hot_action.open_hot_action(video, 'spotify');
        this.hot_action.action = 'song_options';
        this.swipe_x = 0;
        
    }

     public async open_hot_action(video: any, source: Song_Source): Promise<void> {
        this.hot_action.open_hot_action(video, source);
    }

    toggle_like(video: Song_Data | null): void {
        if (!video) return;
        this.dont_play = true;
        
        video.liked = !video.liked;
        // this.media.save_song_to_indexDB(this.current_song_data.id.video_id, this.current_song_data);
        if(video.liked) {
            // console.log('Adding song to favorites:', video);
            this.playlists.add_to_favorites(video);
        } else {
            this.playlists.remove_song_from_playlist(video, this.playlists.favorite_playlist_identifier);
        }
    }

    download_state(video: Song_Data | null): 'not_downloaded' | 'downloading' | 'downloaded' {
        if (!video) return 'not_downloaded';
        if (this.media.is_downloading(video.id.video_id)) return 'downloading';
        if (video.downloaded) return 'downloaded';
        return 'not_downloaded';
    }

    download_icon(video: Song_Data | null): string {
        const state = this.download_state(video);
        if (state === 'not_downloaded') return 'download.svg';
        if (state === 'downloading') return 'loader.svg';
        if (state === 'downloaded') return 'cloud-download.svg';
        return 'download.svg';
    }

    download_video(video: Song_Data | null): void {
        if (!video) return;
        this.dont_play = true;
        this.swipe_x = 0;

        console.log('Requesting download for video:', video, this.media.song_key(video.id));
        
        this.media.request_download(this.media.song_key(video.id), {quality: DownloadQuality.Q0, bit_rate: '128k'});
    }

    open_more_options(): void {
        this.quick_action.quick_action_open = true;
        this.quick_action.action = 'playlist_options';
    }

    open_sort_options(): void {
        this.quick_action.quick_action_open = true;
        this.quick_action.action = 'playlist_sort_options';
    }

    get is_playlist_stored(): boolean {
        return this.playlists.is_playlist_stored(this.playlists.selected_playlist_identifier);
    }

    get is_default_playlist(): boolean {
        return this.playlists.selected_playlist_identifier?.default || false;
    }

    get is_playlist_download_playlist(): boolean {
        return this.playlists.selected_playlist_identifier?.id === '#downloads';
    }

    toggle_playlist_add(): void {
        if (!this.playlists.selected_playlist_identifier) return;
        
        const playlist_name = this.playlists.selected_playlist_identifier.name;
        
        if (this.is_playlist_stored) {
            this.playlists.delete_playlist(this.playlists.selected_playlist_identifier);
            this.notification_service.info(`Removed "${playlist_name}"`, {stackable: false, dismissTime: 3000});
        } else {
            this.playlists.add_playlist(this.playlists.selected_playlist_identifier, this.playlists.selected_playlist);
            this.notification_service.info(`Added "${playlist_name}"`, {stackable: false, dismissTime: 3000});
        }
    }
}

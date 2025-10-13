import { Component, HostListener, HostBinding } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BehaviorSubject } from 'rxjs';
import { DragDropModule, CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { FormsModule } from '@angular/forms';

import { QuickActionService } from '../../quick.action.service';
import { PlaylistsService } from '../../playlists.service';
import { MusicPlayerService } from '../../music.player.service';
import { MusicMediaService, Song_Identifier, Song_Playlist_Identifier, Song_Data, Song_Source } from '../../music.media.service';
import { HotActionService } from '../../hot.action.service';


@Component({
  selector: 'quick-action',
  imports: [CommonModule, DragDropModule, FormsModule],
  templateUrl: './quick.action.component.html',
  styleUrl: './quick.action.component.css'
})
export class QuickActionComponent {
    @HostBinding('class.dragged') get is_dragged(): boolean {
        return this.header_drag_active;
    }

    get action(): string {
        return this.quick_action.action;
    }
    get title(): string {
        switch (this.action) {
            case 'pick_playlist_color': return 'Pick Playlist Color';
            case 'queue_management': return 'Queue';
            case 'download_playlist': return 'Download Playlist';
            default: return 'Quick Action';
        }
    }

    get is_playlist_view_color_the_same_as_selected_playlist(): boolean {
        if(!this.quick_action.playlist_view_color) return true;
        return this.quick_action.playlist_view_color === this.playlists.selected_playlist_identifier?.colors?.primary;
    }

    get playlist_view_color(): string {
        return this.quick_action.playlist_view_color || this.playlists.selected_playlist_identifier?.colors?.primary || '';
    }

    get playlist_contrast_color(): string {
        // returns a color that contrasts with the playlist view color for better accessibility
        return this.quick_action.get_contrast_color(this.playlist_view_color);
    }

    get playlist_text_contrast_color(): string {
        // Returns pure black or white for maximum text readability on playlist backgrounds
        return this.quick_action.get_text_contrast_color(this.playlist_view_color);
    }

    // get visible_videos(): (Song_Data | null)[] {
    //     return this.videos.slice(this.visible_start_index, this.visible_end_index);
    // }
    get padding_top(): string {
        return `${this.visible_start_index * this.item_height}px`;
    }
    get play_next_queue_length(): number {
        return this.player.play_next_queue.length;
    }
    get play_next_queue(): string[] {
        //
        return this.player.play_next_queue;
    }
    get play_next_queue_with_song_data(): Song_Data[] {
        return this.play_next_queue.map(song_key => {
            return this.player.song_cache.get(song_key as string) || null;
        }).filter(song_data => song_data !== null) as Song_Data[];
    }
    get playlist_queue(): string[] {
        //
        return this.player.playlist_queue.slice(this.visible_start_index, this.visible_end_index); 
    }
    get playlist_queue_with_song_data(): Song_Data[] {
        return this.playlist_queue.map(song_key => {
            return this.player.song_cache.get(song_key as string) || null;
        }).filter(song_data => song_data !== null) as Song_Data[];
    }
    get current_song_identifier(): Song_Identifier | null {
        return this.player.song_data ? this.player.song_data.id : null;
    }
    get song_data(): Song_Data | null {
        return this.player.song_data;
    }
    get play_next_queue_duration(): string {
        const songs = this.play_next_queue_with_song_data;
        const total_duration = songs.reduce((acc, song) => {
            return acc + (song.video_duration || 0);
        }, 0);
        return this.ms_to_time(total_duration);
    }
    get playlist_queue_duration(): string {
        const songs = this.playlist_queue_with_song_data;
        const total_duration = songs.reduce((acc, song) => {
            return acc + (song.video_duration || 0);
        }, 0);
        return this.ms_to_time(total_duration);
    }

    @HostListener('scroll', ['$event'])
    on_scroll(event: Event) {
        const target = event.target as HTMLElement;
        const scrollTop = target.scrollTop;
        
        // Calculate visible range based on scroll position
        const new_start = Math.floor(scrollTop / this.item_height);
        const new_end = Math.min(
            new_start + Math.ceil(this.container_height / this.item_height),
            this.player.playlist_queue.length
        );

        const buffered_start = Math.max(0, new_start - this.buffer_size);
        const buffered_end = Math.min(this.player.playlist_queue.length, new_end + this.buffer_size);
        
        // console.log(buffered_start, buffered_end, this.visible_start_index, this.visible_end_index);

        if (Math.abs(buffered_start - this.visible_start_index) > this.significant_change_size || 
            Math.abs(buffered_end - this.visible_end_index) > this.significant_change_size) {
            
            this.visible_start_index = buffered_start;
            this.visible_end_index = buffered_end;

            console.log('Updated visible range:', this.visible_start_index, 'to', this.visible_end_index);
        }
    }

    is_downloading(video_id: string): boolean {
        return this.media.is_downloading(video_id); 
    }
    video_progress(video_id: string): number {
        return this.media.download_progress(video_id); // return the current download progress
    }
    get_bare_song_key(identifier: Song_Identifier | null | undefined): string {
        if (!identifier) return '';
        return this.media.bare_song_key(identifier);
    }
    get_artwork_src(video: Song_Data | null): string {
        if (!video) return '';
        
        // If we have a downloaded blob, create a blob URL
        if (video.download_artwork_blob) {
            return URL.createObjectURL(video.download_artwork_blob);
        }
        
        // Otherwise use the regular URL
        return video.url?.artwork?.low || video.url?.artwork?.high || '';
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

    ms_to_time(ms: number): string {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
            return `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
    }

    playlist_color_options: string[][] = [
        // Keep the original pink row
        ['hsl(342deg 82% 30%)', 'hsl(342deg 82% 50%)', 'hsl(342deg 82% 65%)', 'hsl(342deg 82% 80%)'],
        
        // Red (0°) - 5 shades
        [ 'hsl(0deg 80% 35%)', 'hsl(0deg 80% 50%)', 'hsl(0deg 80% 65%)', 'hsl(0deg 80% 80%)'],
        
        // Orange (60°) - 5 shades  
        [ 'hsl(33, 72%, 35%)', 'hsl(33, 72%, 50%)', 'hsl(33, 72%, 65%)', 'hsl(33, 72%, 80%)'],

        // Yellow (60°) - 5 shades
        [ 'hsl(60, 100%, 35%)', 'hsl(60, 100%, 50%)', 'hsl(60, 100%, 65%)', 'hsl(60, 100%, 80%)'],
        
        // Green (120°) - 5 shades
        [ 'hsl(150, 84%, 35%)', 'hsl(150, 84%, 50%)', 'hsl(150, 84%, 65%)', 'hsl(150, 84%, 80%)'],
        
        // Cyan (180°) - 5 shades
        [ 'hsl(180deg 80% 35%)', 'hsl(180deg 80% 50%)', 'hsl(180deg 80% 65%)', 'hsl(180deg 80% 80%)'],
        
        // Blue (240°) - 5 shades
        [ 'hsl(218, 79%, 35%)', 'hsl(218, 79%, 50%)', 'hsl(218, 79%, 65%)', 'hsl(218, 79%, 80%)'],
        
        // Magenta (300°) - 5 shades
        [ 'hsl(300deg 80% 35%)', 'hsl(300deg 80% 50%)', 'hsl(300deg 80% 65%)', 'hsl(300deg 80% 80%)'],

        // gray scale
        ['hsl(0deg 0% 40%)', 'hsl(0deg 0% 55%)', 'hsl(0deg 0% 80%)', 'hsl(0deg 0% 100%)']
    ]

    constructor(private quick_action: QuickActionService, private playlists: PlaylistsService, private player: MusicPlayerService, private media: MusicMediaService, private hot_action: HotActionService) {}

    cancel() {
        this.quick_action.reset();
    }

    select_view_color(color: string) {
        this.quick_action.playlist_view_color = color;
    }

    set_playlist_color() {
        this.quick_action.quick_action_open = false;
        if (!this.playlists.selected_playlist_identifier) return;
        if(!this.quick_action.playlist_view_color) return;

        this.playlists.set_playlist_color(
            this.playlists.selected_playlist_identifier.id,
            this.quick_action.playlist_view_color
        );

        this.quick_action.playlist_view_color = '';
    }

    get_playlist_color(): string {
        if (!this.playlists.selected_playlist_identifier) return '';
        return this.playlists.selected_playlist_identifier.colors?.primary || '';
    }

    set quick_action_open(value: boolean) {
        this.quick_action.quick_action_open = value;
    }

    significant_change_size = 5; // how many elements you have to scroll past before loading new ones
    visible_start_index = 0;
    visible_end_index = 75; // Show 75 items initially
    buffer_size = 25; // Load 25 extra items after visible area
    item_height = 60; // Height of each playlist item in pixels
    container_height = 700; // Height of scrollable container

    swiping_video: string = '';
    deleted_swiping_video: string = '';
    added_to_next_swiping_video: string = '';
    swiping_video_data: Song_Data | null = null;
    swipe_state: 'closed' | 'open' | 'dragging' = 'closed';
    swipe_start_x: number = 0;
    swipe_delta_x: number = 0;
    swipe_x: number = 0;
    idle_swipe_open_size: number = 60; 
    delete_swipe_open_size: number = 150; // distance to travel before deleting
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

    video_key(song_data: Song_Data | null | undefined, index: number | undefined): string {
        if (!song_data) return '';
        return this.media.bare_song_key(song_data.id) + (index !== undefined ? `-${index}` : '');
    }
    
    video_on_swipe_start(event: TouchEvent | MouseEvent, video: Song_Data | null, index: number): void {
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
        const new_song_key = this.video_key(video, index);
        if(this.swiping_video !== new_song_key) {
            this.swipe_start_x = clientX;
            this.swipe_x = 0;
        } else {
            // same video 
            if(this.swipe_state === 'open') {
                this.swipe_start_x = clientX + this.idle_swipe_open_size; // Keep it open
            } else {
                this.swipe_start_x = clientX; // Start from current position
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
    async video_on_swipe_end(event: TouchEvent | MouseEvent, delete_from: string): Promise<void> {
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
                // this.delete_video_from_playlist(this.swiping_video_data);
                setTimeout(() => {
                    // delete from queue array
                    if(delete_from === "play_next") {
                        const index_identifier_index = this.swiping_video.lastIndexOf('-');
                        const index_identifier = parseInt(this.swiping_video.substring(index_identifier_index + 1));
                        this.player.play_next_queue.splice(index_identifier, 1);
                    } else {
                        const index_identifier_index = this.swiping_video.lastIndexOf('-');
                        // console.log(this.swiping_video);
                        const index_identifier = parseInt(this.swiping_video.substring(index_identifier_index + 1));
                        // console.log(index_identifier);
                        this.player.playlist_queue.splice(index_identifier - this.play_next_queue_with_song_data.length - 1, 1);
                        // console.log(index_identifier - this.play_next_queue_with_song_data.length)
                        // this.player.playlist_queue.queue = this.player.playlist_queue.queue.filter(song => {
                        //     return this.media.bare_song_key(song) !== this.video_key(this.swiping_video_data, undefined);
                        // });
                    }
                }, 395);
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
            // This is a tap - play
            this.gesture_type = 'tap';
            if (this.swiping_video_data) {
                await this.play(this.swiping_video_data);
            }
        }

        // Reset gesture state
        this.is_gesture_active = false;
        this.gesture_type = 'none';
        this.dont_play = false;

        event.stopPropagation();
    }

    async play(track_data: Song_Data | null) {
        if(this.dont_play) {
            // this.dont_play = false;
            return;
        }
        if (!track_data) return;
        
        this.player.open_player.emit();

        // this.player.update_media_session(track_data, this.media.song_key(track_data.id));

        await this.player.load_and_play_track(track_data);
        // this.player.remove_current_song_from_queue();
    }

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
            
            if(this.dragging) return; // If dragging, don't update hold progress
            if (elapsed >= this.hold_timeout) {
                if(this.dragging) return;
                // Hold gesture completed
                this.gesture_type = 'hold';
                this.swipe_x = 0;
                console.log('Hold gesture detected');
                this.trigger_add_to_next(video);
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
        if(this.dragging) return;
        this.player.add_song_to_play_next(video);
        
        // Trigger success animation
        this.play_add_to_next_animation();
        
        // Reset states
        this.is_gesture_active = false;
        this.dont_play = true; // Prevent immediate play after hold
        this.gesture_type = 'none';
        this.hold_progress = 0;
    }

    private play_add_to_next_animation(): void {
        // Create a visual feedback animation
        this.added_to_next_swiping_video = this.swiping_video; // Store the video being added to next
        setTimeout(() => {
            this.added_to_next_swiping_video = ''; 
        }, 200);
    }

    private play_delete_animation(): void {
        // Create a visual feedback animation for delete
        this.deleted_swiping_video = this.swiping_video; // Store the video being deleted
        setTimeout(() => {
            this.deleted_swiping_video = ''; 
            this.swipe_x = 0;
        }, 400);
        this.animate_swipe_value(this.swipe_x, -window.innerWidth, 300);
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

    get playlist_identifier(): Song_Playlist_Identifier | null {
        return this.playlists.selected_playlist_identifier;
    }

    download_playlist(): void {
        this.quick_action.quick_action_open = false;
        if (!this.playlists.selected_playlist_identifier) return;

        this.playlists.download_playlist(
            this.playlists.selected_playlist
        );
    }

    get_object_url(blob: Blob | null): string {
        if (!blob) return '';
        return URL.createObjectURL(blob);
    }

    // Drag and Drop Methods
    onDrop(event: CdkDragDrop<string[]>) {
        const previousContainer = event.previousContainer;
        const currentContainer = event.container;
        
        if (previousContainer === currentContainer) {
            // Reordering within the same queue
            if (currentContainer.id === 'play-next-queue') {
                this.reorderPlayNextQueue(event.previousIndex, event.currentIndex);
            } else if (currentContainer.id === 'playlist-queue') {
                this.reorderPlaylistQueue(event.previousIndex, event.currentIndex);
            }
        } else {
            // Moving between queues
            if (previousContainer.id === 'play-next-queue' && currentContainer.id === 'playlist-queue') {
                this.moveFromPlayNextToPlaylist(event.previousIndex, event.currentIndex);
            } else if (previousContainer.id === 'playlist-queue' && currentContainer.id === 'play-next-queue') {
                this.moveFromPlaylistToPlayNext(event.previousIndex, event.currentIndex);
            }
        }
        this.player.preload_next_track();
        
        // Reset any active swipe state after drag operation
        this.resetSwipeState();
    }

    private resetSwipeState() {
        this.swipe_x = 0;
        this.swipe_state = 'closed';
        this.swiping_video = '';
        this.swiping_video_data = null;
        this.is_gesture_active = false;
        this.gesture_type = 'none';
    }

    private reorderPlayNextQueue(previousIndex: number, currentIndex: number) {
        const queue = [...this.player.play_next_queue];
        moveItemInArray(queue, previousIndex, currentIndex);
        this.player.play_next_queue = queue;
    }

    private reorderPlaylistQueue(previousIndex: number, currentIndex: number) {
        const queue = [...this.player.playlist_queue];
        const adjustedPreviousIndex = previousIndex + this.visible_start_index;
        const adjustedCurrentIndex = currentIndex + this.visible_start_index;
        moveItemInArray(queue, adjustedPreviousIndex, adjustedCurrentIndex);
        this.player.playlist_queue = queue;
    }

    private moveFromPlayNextToPlaylist(previousIndex: number, currentIndex: number) {
        const playNextQueue = [...this.player.play_next_queue];
        const playlistQueue = [...this.player.playlist_queue];
        const adjustedCurrentIndex = currentIndex + this.visible_start_index;
        
        transferArrayItem(
            playNextQueue,
            playlistQueue,
            previousIndex,
            adjustedCurrentIndex
        );
        
        this.player.play_next_queue = playNextQueue;
        this.player.playlist_queue = playlistQueue;
    }

    private moveFromPlaylistToPlayNext(previousIndex: number, currentIndex: number) {
        const playNextQueue = [...this.player.play_next_queue];
        const playlistQueue = [...this.player.playlist_queue];
        const adjustedPreviousIndex = previousIndex + this.visible_start_index;
        
        transferArrayItem(
            playlistQueue,
            playNextQueue,
            adjustedPreviousIndex,
            currentIndex
        );
        
        this.player.play_next_queue = playNextQueue;
        this.player.playlist_queue = playlistQueue;
    }

    // Predicate functions for drag-and-drop constraints
    canDropInPlayNext = (item: any) => {
        return true; // Allow all items to be dropped in play next
    }

    canDropInPlaylist = (item: any) => {
        return true; // Allow all items to be dropped in playlist
    }


    dragging = false;
    start_dragging() {
        // Disable swipe when drag starts
        this.resetSwipeState();
        this.dragging = true;
    }

    stop_dragging() {
        this.dragging = false;
    }

    // Header drag properties
    header_drag_active = false;
    header_drag_start_y = 0;
    header_drag_y = 0;
    header_drag_threshold = 100; // Distance to pull down before closing
    get header_transform(): string {
        return this.header_drag_y > 0 ? `translateY(${this.header_drag_y}px)` : '';
    }

    header_on_drag_start(event: TouchEvent | MouseEvent): void {
        let clientY: number;
        
        if (event instanceof TouchEvent) {
            clientY = event.touches[0].clientY;
        } else {
            clientY = event.clientY;
        }

        this.header_drag_active = true;
        this.header_drag_start_y = clientY;
        this.header_drag_y = 0;

        event.stopPropagation();
    }

    header_on_drag_move(event: TouchEvent | MouseEvent): void {
        if (!this.header_drag_active) return;
        
        let clientY: number;
        
        if (event instanceof TouchEvent) {
            clientY = event.touches[0].clientY;
        } else {
            clientY = event.clientY;
        }

        const deltaY = clientY - this.header_drag_start_y;
        
        // Only allow downward drag (positive deltaY)
        this.header_drag_y = Math.max(0, deltaY);

        event.preventDefault();
        event.stopPropagation();
    }

    header_on_drag_end(event: TouchEvent | MouseEvent): void {
        if (!this.header_drag_active) return;

        const should_close = this.header_drag_y > this.header_drag_threshold;

        if (should_close) {
            // Animate to fully closed position
            this.animate_header_close();
        } else {
            // Snap back to original position
            this.animate_header_value(this.header_drag_y, 0);
        }

        this.header_drag_active = false;
        event.stopPropagation();
    }

    private animate_header_value(from: number, to: number, duration: number = 200): void {
        this.animateValue(from, to, duration, this.easeOutCubic).subscribe(value => {
            this.header_drag_y = value;
        });
    }

    private animate_header_close(): void {
        const distance = window.innerHeight - this.header_drag_y;
        this.animateValue(this.header_drag_y, window.innerHeight, 300, this.easeOutCubic).subscribe({
            next: (value) => {
                this.header_drag_y = value;
            },
            complete: () => {
                // Close the quick action after animation
                this.quick_action_open = false;
                this.header_drag_y = 0;
            }
        });
    }

    remove_from_play_next(video: Song_Data | null, index: number, delete_from: string = "play_next") {
        if (!video) return;

        // Remove from play next queue
        if(delete_from === "play_next") {
            this.player.play_next_queue.splice(index, 1);
        } else {
            this.player.playlist_queue.splice(index, 1);
            // Remove from main playlist queue
            // this.player.playlist_queue.queue = this.player.playlist_queue.queue.filter(song => {
            //     return this.media.bare_song_key(song) !== this.video_key(this.swiping_video_data, undefined);
            // });
        }
    }

    dont_play: boolean = false;
    open_more_options(video: Song_Data | null) {
        if (!video) return;
        this.dont_play = true;

        this.hot_action.open_hot_action(video, 'spotify');
        this.hot_action.action = 'add_to_playlist';
        this.swipe_x = 0;
    }

    // remove 'Alphabetical' from sort options for now
    public sort_options = ['Title', 'Artist', 'Recently Added (Oldest)', 'Recently Added (Newest)'];
    public is_sort_option_selected(option: string): boolean {
        switch(this.playlists.selected_playlist?.sorting_method) {
            case 'alphabetical': return option === 'Alphabetical';
            case 'title': return option === 'Title';
            case 'artist': return option === 'Artist';
            case 'old_to_recent': return option === 'Recently Added (Oldest)';
            case 'recent_to_old': return option === 'Recently Added (Newest)';
            default: return false;
        }
    }

    public select_sort_option(option: string): void {
        if (!this.playlists.selected_playlist) return;
        switch(option) {
            case 'Alphabetical': this.playlists.set_playlist_sorting_method(this.playlists.selected_playlist, 'alphabetical'); break;
            case 'Title': this.playlists.set_playlist_sorting_method(this.playlists.selected_playlist, 'title'); break;
            case 'Artist': this.playlists.set_playlist_sorting_method(this.playlists.selected_playlist, 'artist'); break;
            case 'Recently Added (Oldest)': this.playlists.set_playlist_sorting_method(this.playlists.selected_playlist, 'old_to_recent'); break;
            case 'Recently Added (Newest)': this.playlists.set_playlist_sorting_method(this.playlists.selected_playlist, 'recent_to_old'); break;
            default: break;
        }
        this.quick_action.quick_action_open = false;
    }

    get is_default_playlist(): boolean {
        if (!this.playlists.selected_playlist_identifier) return false;
        return this.playlists.selected_playlist_identifier.default || false;
    }
    public playlist_options = [
        // true or false is whether to allow for default playlists
        ['Playlist Color', 'palette.svg', '#playlist_color', "true"],
        ['Download Playlist', 'download.svg', 'var(--color-text)', "true"],
        ['Sort Playlist', 'arrows-sort.svg', 'var(--color-text)', "true"],
        ['Edit Name', 'edit.svg', 'var(--color-text)', "false"],
        ['Delete Playlist', 'trash.svg', 'var(--color-deny)', "false"]
    ];
    public select_playlist_option(option: string, allow: boolean = true): void {
        if (!allow) return;
        switch(option) {
            case 'Playlist Color':this.quick_action.action = 'pick_playlist_color'; break;
            case 'Download Playlist': this.quick_action.action = 'download_playlist'; break;
            case 'Sort Playlist': this.quick_action.action = 'playlist_sort_options'; break;
            case 'Edit Name': 
                this.quick_action.action = 'rename_playlist';
                this.new_playlist_name = this.playlists.selected_playlist?.name || '';
                break;
            case 'Delete Playlist': 
               this.remove_playlist();
               this.quick_action.quick_action_open = false;
               break;
            default: break;
        }
    }

    private remove_playlist(): void {
        if (!this.playlists.selected_playlist_identifier) return;
        this.playlists.delete_playlist(this.playlists.selected_playlist_identifier);
    }

    public is_playlist_name_valid(): boolean {
        if (!this.new_playlist_name.trim()) return false; // Prevent empty names
        if (!this.playlists.selected_playlist) return false;
        return true;
    }

    get current_playlist_name(): string {
        return this.playlists.selected_playlist?.name || '';
    }

    public new_playlist_name: string = '';
    public confirm_rename_playlist(): void {
        if (!this.is_playlist_name_valid()) return;
        if (this.new_playlist_name.trim() === this.playlists.selected_playlist.name) {
            this.quick_action.quick_action_open = false;
            return; // No change
        }

        this.playlists.selected_playlist_identifier.name = this.new_playlist_name.trim();
        this.playlists.selected_playlist.name = this.new_playlist_name.trim();
        this.playlists.save_playlists();
        this.playlists.save_playlist(this.playlists.selected_playlist_identifier, this.playlists.selected_playlist);

        this.quick_action.quick_action_open = false;
    }
}

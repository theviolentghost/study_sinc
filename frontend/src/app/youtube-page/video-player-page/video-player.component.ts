import { Component, HostListener, OnDestroy, NgZone} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { YoutubeService } from '../youtube.service';
import { FullVideoData, PlaylistVideo } from '../youtube-playlist-results.model';
import { WatchHistoryService } from '../watch-history.service';
import { YoutubeSubscriptionService } from '../youtube-subscription.service';

@Component({
  selector: 'app-video-player-page',
  imports: [RouterModule, CommonModule],
  standalone: true,
  templateUrl: './video-player.component.html',
  styleUrl: './video-player.component.css'
})
export class VideoPlayerPageComponent {
  isSubscribed = false;

  playingVideo: PlaylistVideo;
  fullVideoSub;
  fullVideoData: FullVideoData;

  private scrollListener: () => void;
  private resizeListener: () => void;

  constructor(private router: Router,
    private youtubeService: YoutubeService,
    private watchHistoryService: WatchHistoryService,
    private youtubeSubscriptionService: YoutubeSubscriptionService,
    private zone: NgZone
  ){}

  ngOnInit() {
    window.scroll(0, 0);
    this.playingVideo = this.watchHistoryService.getSavedVideoData();
    this.youtubeService.expandPlayer();

    this.fullVideoSub = this.youtubeService.fullPlayingVideoData$.subscribe(data => {
      if(!data) return;
      this.fullVideoData = data;
    });
  }

  ngAfterViewInit() {
    this.zone.runOutsideAngular(() => {
      this.scrollListener = () => this.syncPlayerPosition();
      this.resizeListener = () => this.syncPlayerPosition();
      window.addEventListener('scroll', this.scrollListener, { passive: true });
      window.addEventListener('resize', this.resizeListener, { passive: true });
    });
    
    requestAnimationFrame(() => {
      this.syncPlayerPosition();
    });
  }

  ngOnDestroy(){
    window.removeEventListener('scroll', this.scrollListener);
    window.removeEventListener('resize', this.resizeListener);

    const globalPlayer = document.getElementById('video_player_container');
    if (globalPlayer) {
      globalPlayer.style.top = '';
      globalPlayer.style.left = '';
      globalPlayer.style.width = '';
      globalPlayer.style.height = '';
    }

    if(!this.youtubeService.isDisplayingVideo) return;
    this.youtubeService.minimizePlayer();
    this.fullVideoSub.unsubscribe();
  }

  private syncPlayerPosition(): void {
    const placeholder = document.getElementById('video_player');
    const globalPlayer = document.getElementById('video_player_container');
    
    if (placeholder && globalPlayer && !this.youtubeService.isMinimized) {
      const rect = placeholder.getBoundingClientRect();
      
      // Update global player style directly to bypass Angular's change detection lag
      globalPlayer.style.top = `${rect.top}px`;
      globalPlayer.style.left = `${rect.left}px`;
      globalPlayer.style.width = `${rect.width}px`;
      globalPlayer.style.height = `${rect.height}px`;
      
      // Still update the service for state consistency, but we've already updated the DOM
      this.youtubeService.videoPlayerWidth = rect.width;
      this.youtubeService.videoPlayerY = window.scrollY || document.documentElement.scrollTop;
    }
  }

  public toggleIsSubscribed(channelId: string): void{
    this.isSubscribed = !this.isSubscribed;

    if(this.isSubscribed){
      this.youtubeSubscriptionService.subscribeToChannel(channelId);
      return;
    } 

    this.youtubeSubscriptionService.unsubscribeToChannel(channelId);
  }

  public playNewVideo(video: PlaylistVideo): void{
    this.youtubeService.playNewVideo(video);
  }

  public navigateToChannel(channelId: string): void {
    this.youtubeService.navigateToChannel(channelId);
  }

  public isSubscribedToChannel(channelId: string): boolean{
    return this.youtubeSubscriptionService.isSubscribed(channelId);
  }

  timeAgo(isoTime: string): string{
    return this.youtubeService.timeAgo(isoTime);
  }

}

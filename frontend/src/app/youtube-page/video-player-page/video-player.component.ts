import { Component, HostListener, OnDestroy} from '@angular/core';
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

  constructor(private router: Router,
    private youtubeService: YoutubeService,
    private watchHistoryService: WatchHistoryService,
    private youtubeSubscriptionService: YoutubeSubscriptionService
  ){}

  ngOnInit() {
    window.scroll(0, 0);
    this.playingVideo = this.watchHistoryService.getSavedVideoData();

    this.fullVideoSub = this.youtubeService.fullPlayingVideoData$.subscribe(data => {
      if(!data) return;
      this.fullVideoData = data;
    });
  }

  ngAfterViewInit() {
    setTimeout(() => {
      this.savePlayerWidth();
      this.savePlayerScroll();
    });
  }

  ngOnDestroy(){
    if(!this.youtubeService.isDisplayingVideo) return;
    this.youtubeService.minimizePlayer();
    this.fullVideoSub.unsubscribe();
  }

  @HostListener('window:resize')
  onResize() {
    this.savePlayerWidth();
  }

  @HostListener('window:scroll', ['$event'])
  onWindowScroll(event: Event) {
    this.savePlayerScroll();
  }

  public savePlayerWidth(): void{
    let container = document.getElementById('video_player');
    this.youtubeService.videoPlayerWidth = container.offsetWidth;
  }

  public savePlayerScroll(): void{
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    this.youtubeService.videoPlayerY = scrollY;
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

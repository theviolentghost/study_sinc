import { Component, OnInit, OnDestroy, AfterViewInit, ViewChildren, QueryList, ElementRef} from '@angular/core';
import { CommonModule } from '@angular/common';
import { YoutubeService } from '../youtube.service';
import { SubscriptionUploads, SubscriptionData, YouTubeChannel } from '../youtube-channel-search-results.model';
import { YoutubeSubscriptionService } from '../youtube-subscription.service';
import { PlaylistVideo } from '../youtube-playlist-results.model';
import { take, debounceTime } from 'rxjs/operators';
import { WatchHistoryService } from '../watch-history.service';

@Component({
  selector: 'app-subcription-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './subcription-page.component.html',
  styleUrl: './subcription-page.component.css'
})
export class SubcriptionPageComponent {

  canLoadMoreUploads:boolean;

  sortedUploads: PlaylistVideo[] = [];
  subscriptionsSub;
  subscriptions:SubscriptionData[];
  allChannelUploadsSub;
  allChannelUploads: SubscriptionUploads[];


  onScreenObserver: IntersectionObserver;

  constructor(private youtubeService: YoutubeService,
    private youtubeSubsciptionService: YoutubeSubscriptionService,
    private watchHistoryService: WatchHistoryService
  ){}

  ngOnInit(){
    var voidInput: HTMLInputElement = document.getElementById("time_void_amount") as HTMLInputElement;
    voidInput.value = "60"
    window.scrollTo(0, 0);
    setTimeout(() => this.canLoadMoreUploads = true, 3000);

    this.onScreenObserver = new IntersectionObserver(this.handleIntersect.bind(this), {
      threshold: 0.1,
    });

    this.subscriptionsSub = this.youtubeSubsciptionService.channelDataList$
      .pipe(debounceTime(100))
      .subscribe(channels => {
      if(!channels) return;
      this.subscriptions = this.youtubeSubsciptionService.allSubscriptions;
      for(let i = 0; i < channels.length; i++){
        if(channels[i].initialized || !channels[i].uploadsId) continue;
        this.initializeChannelUploads(channels[i]);
      }
    });

    this.allChannelUploadsSub = this.youtubeSubsciptionService.channelUploadsList$
      .pipe(debounceTime(200))
      .subscribe(allChannelUploads => {
      if(!allChannelUploads) return;
      this.allChannelUploads = allChannelUploads;
      
      const voidThreshold = parseInt(voidInput.value) || 60;
      const videos: (PlaylistVideo & { secondsAgo?: number })[] = [];

      for(let channel = 0; channel < this.allChannelUploads.length; channel++){
        const uploads = this.allChannelUploads[channel].uploads;
        for(let video = 0; video < uploads.length; video++){
          const v = uploads[video];
          if(this.timeStringToSeconds(v.duration) < voidThreshold) continue;
          
          (v as any).secondsAgo = this.youtubeTimeAgoToSeconds(v.uploadDate);
          videos.push(v);
        }
      } 
      
      videos.sort((a, b) => (a.secondsAgo || 0) - (b.secondsAgo || 0));
      this.sortedUploads = videos;
    });
  }

  trackByVideoId(index: number, video: PlaylistVideo): string {
    return video.id;
  }

  @ViewChildren('videoItem', { read: ElementRef })
  videoElements!: QueryList<ElementRef>;
  ngAfterViewInit() {
    this.observeAll();

    this.videoElements.changes.subscribe(() => {
      this.observeAll();
    });
  }

  observeAll() {
    this.videoElements.forEach(video => {
      this.onScreenObserver.observe(video.nativeElement);
    });
  }

  handleIntersect(entries: IntersectionObserverEntry[]) {
    entries.forEach(entry => {
      const videoElement = entry.target as HTMLElement;
      const thumbnail = videoElement.querySelector('.thumbnail') as HTMLElement;
      const originalUrl = thumbnail.getAttribute('background-url');

      if (entry.isIntersecting) {
        if (originalUrl) {
          thumbnail.style.backgroundImage = `url(${originalUrl})`;
        }
        
        let playlistId = videoElement.getAttribute('playlist-id');
        let videoId = videoElement.getAttribute('video-id');

        if(this.youtubeSubsciptionService.isLastLoadedUpload(playlistId, videoId)){
          if(!this.canLoadMoreUploads) return;
          this.youtubeSubsciptionService.loadMoreUploads(playlistId);
        }
      } else {
        thumbnail.style.backgroundImage = 'none';
      }
    });
  }

  ngOnDestroy(){
    this.subscriptionsSub.unsubscribe();
    this.onScreenObserver.disconnect();
  }

  getPlaylistId(channelId: string): string{
    for(let channel = 0; channel < this.subscriptions.length; channel++){
      if(this.subscriptions[channel].channelId !== channelId) continue;

      return this.subscriptions[channel].uploadsId;
    }
    return '';
  }

  playNewVideo(video: PlaylistVideo){
    this.youtubeService.playNewVideo(video);
  }

  navigateToChannel(channelId: string): void {
    this.youtubeService.navigateToChannel(channelId);
  }

  initializeChannelUploads(channel: SubscriptionData): void{
    this.youtubeSubsciptionService.initializeChannelUploads(channel);
  }

  timeAgo(isoTime: string): string{
    return this.youtubeService.timeAgo(isoTime);
  }

  getVideoProgressPercent(videoId: string): number{
    return this.watchHistoryService.getVideoProgress(videoId) * 100;
  }

  wasWatched(videoId: string): boolean{
    return this.watchHistoryService.wasWatched(videoId);
  }

  youtubeTimeAgoToSeconds(timeAgo: string): number {
    if (!timeAgo) return 3153600000; // 100 years ago

    const lowerTime = timeAgo.toLowerCase().trim();
    if (lowerTime.includes("just now")) return 0;

    // Remove "Streamed" prefix if present
    let cleanTime = lowerTime.replace(/^streamed\s+/, '');

    // Regex to match value and unit, handling optional space (e.g., "4m", "4 m", "4 minutes")
    const match = cleanTime.match(/(\d+)\s*([a-z]+)/);
    
    if (!match) return 3153600000; // unknown format, push to bottom

    const value = parseInt(match[1], 10);
    const unit = match[2];

    let seconds = 0;
    if (unit.startsWith("s")) {
      seconds = value;
    } else if (unit.startsWith("mi")) {
      seconds = value * 60;
    } else if (unit.startsWith("h")) {
      seconds = value * 3600;
    } else if (unit.startsWith("d")) {
      seconds = value * 86400;
    } else if (unit.startsWith("w")) {
      seconds = value * 604800;
    } else if (unit.startsWith("m")) {
      // Month vs Minute check: minute is usually "m" or "min", month is "month"
      // But in YouTube's joined format "4m ago" means minutes.
      // If it starts with "mi" it's minutes. If it's just "m" it's usually minutes.
      // If it's "mo" or "month" it's months.
      if (unit.startsWith("mo")) {
        seconds = value * 2592000;
      } else {
        seconds = value * 60;
      }
    } else if (unit.startsWith("y")) {
      seconds = value * 31536000;
    } else {
      return 3153600000; // unknown unit
    }

    return seconds;
  }

  timeStringToSeconds(time: string): number {
    if(!time) return 0;
    const parts = time.split(':').map(Number);
    let seconds = 0;

    if (parts.length === 3) {
      seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      seconds = parts[0] * 60 + parts[1];
    } else if (parts.length === 1) {
      seconds = parts[0];
    }

    return seconds;
  }
}

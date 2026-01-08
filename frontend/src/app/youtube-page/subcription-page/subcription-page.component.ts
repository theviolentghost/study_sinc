import { Component, OnInit, OnDestroy, AfterViewInit, ViewChildren, QueryList, ElementRef} from '@angular/core';
import { CommonModule } from '@angular/common';
import { YoutubeService } from '../youtube.service';
import { SubscriptionUploads, SubscriptionData, YouTubeChannel } from '../youtube-channel-search-results.model';
import { YoutubeSubscriptionService } from '../youtube-subscription.service';
import { PlaylistVideo } from '../youtube-playlist-results.model';
import { take } from 'rxjs/operators';
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
    window.scrollTo(0, 0);
    setTimeout(() => this.canLoadMoreUploads = true, 500);

    this.onScreenObserver = new IntersectionObserver(this.handleIntersect.bind(this), {
      threshold: 0.1,
    });

    this.subscriptionsSub = this.youtubeSubsciptionService.channelDataList$.subscribe(channels => {
      if(!channels) return;
      this.subscriptions = this.youtubeSubsciptionService.allSubscriptions;
      for(let i = 0; i < channels.length; i++){
        if(channels[i].initialized || !channels[i].uploadsId) continue;
        this.initializeChannelUploads(channels[i]);
      }
    });

    this.allChannelUploadsSub = this.youtubeSubsciptionService.channelUploadsList$.subscribe(allChannelUploads => {
      if(!allChannelUploads) return;
      this.allChannelUploads = allChannelUploads;
      this.sortedUploads = [];

      for(let channel = 0; channel < this.allChannelUploads.length; channel++){
        for(let video = 0; video < allChannelUploads[channel].uploads.length; video++){
          this.sortedUploads.push(allChannelUploads[channel].uploads[video]);
        }
      } 
      this.sortedUploads.sort((a, b) => this.youtubeTimeAgoToSeconds(a.uploadDate) - this.youtubeTimeAgoToSeconds(b.uploadDate));
    });
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

      thumbnail.dataset['backgroundImage'] = thumbnail.style.backgroundImage;;
      const originalUrl = thumbnail.getAttribute('background-url');

      if (entry.isIntersecting) {
        thumbnail.style.backgroundImage = `url(${originalUrl})`;
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
  const parts = timeAgo.split(" ");
  if (parts.length < 2) return 0;

  const value = parseInt(parts[0], 10);
  const unit = parts[1].toLowerCase();

  let seconds = 0;
  if (unit.startsWith("second")) {
    seconds = value;
  } else if (unit.startsWith("minute")) {
    seconds = value * 60;
  } else if (unit.startsWith("hour")) {
    seconds = value * 60 * 60;
  } else if (unit.startsWith("day")) {
    seconds = value * 24 * 60 * 60;
  } else if (unit.startsWith("week")) {
    seconds = value * 7 * 24 * 60 * 60;
  } else if (unit.startsWith("month")) {
    seconds = value * 30 * 24 * 60 * 60;
  } else if (unit.startsWith("year")) {
    seconds = value * 365 * 24 * 60 * 60;
  }

  return seconds;
}
}

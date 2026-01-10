import { Component, OnInit, OnDestroy, HostListener} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { YoutubeService } from '../youtube.service';
import { YouTubeChannel } from '../youtube-channel-search-results.model';
import { SearchResultItem, YouTubeSearchResponse } from '../video-search-result.model';
import { PlaylistVideo } from '../youtube-playlist-results.model';
import { YoutubeSubscriptionService } from '../youtube-subscription.service';
import { WatchHistoryService } from '../watch-history.service';

@Component({
  selector: 'app-video-channel',
  standalone: true,
  imports: [RouterModule, CommonModule],
  templateUrl: './video-channel.component.html',
  styleUrl: './video-channel.component.css'
})
export class VideoChannelComponent {

  isSubscribed = false;
  channelSub;
  currentChannel: YouTubeChannel;
  isAddingToUploads = false;
  uploadsSub;
  channelUploads: PlaylistVideo[];

  constructor(private router: Router,
    private youtubeService: YoutubeService,
    private youtubeSubscriptionService: YoutubeSubscriptionService,
    private watchHistoryService: WatchHistoryService
  ){}

  ngOnInit() {
    window.scrollTo(0, 0);
    this.channelSub = this.youtubeService.channel$.subscribe(channel => {
      this.currentChannel = channel;
      if(!this.currentChannel) return;

      this.isSubscribed = this.youtubeSubscriptionService.isSubscribed(channel.channelId);
    });

    this.uploadsSub = this.youtubeService.channelUploads$.subscribe(videos => {
      this.channelUploads = videos;
      this.isAddingToUploads = false;
    });
  }

  ngOnDestroy() {
    this.channelSub.unsubscribe();
    this.uploadsSub.unsubscribe();
  }

  @HostListener('window:scroll', ['$event'])
  onWindowScroll(event: Event) {
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    let pageHeight;
    try{
      pageHeight = document.getElementById('page_container').offsetHeight - document.body.offsetHeight;
    } catch{
      return;
    }

    if (!this.isAddingToUploads && scrollY >= pageHeight){ 
      this.isAddingToUploads = true;
      this.youtubeService.addToUploadList();
    }
  }

  public loadMoreUploads(){
    this.youtubeService.addToUploadList();
  }

  public toggleIsSubscribed(channelId: string): void{
    this.isSubscribed = !this.isSubscribed;

    if(this.isSubscribed){
      this.youtubeSubscriptionService.subscribeToChannel(channelId);
      return;
    } 

    this.youtubeSubscriptionService.unsubscribeToChannel(channelId);
  }

  playNewVideo(video: PlaylistVideo){
    this.youtubeService.playNewVideo(video);
  }

  public timeAgo(isoDate) {
    return this.youtubeService.timeAgo(isoDate);
  }

  getVideoProgressPercent(videoId: string): number{
    return this.watchHistoryService.getVideoProgress(videoId) * 100;
  }

  wasWatched(videoId: string): boolean{
    return this.watchHistoryService.wasWatched(videoId);
  }
}

import { Injectable } from '@angular/core';
import { SubscriptionUploads, SubscriptionData } from './youtube-channel-search-results.model';
import { BehaviorSubject, Observable, take } from 'rxjs';
import { YoutubeService } from './youtube.service';
import { HttpClient } from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class YoutubeSubscriptionService {

    private SUBSCRIPTION_LIST_KEY = 'subscriptionListKey';

    private initialized = false;

    private _allSubscriptions: SubscriptionData[] = [];
    private _allChannelUploads: SubscriptionUploads[] = [];
    private _channelIdList: string[] = [];

    private channelDataListSubject = new BehaviorSubject<SubscriptionData[] | null>(null);
    channelDataList$: Observable<SubscriptionData[] | null> = this.channelDataListSubject.asObservable();
    private channelUploadsListSubject = new BehaviorSubject<SubscriptionUploads[] | null>(null);
    channelUploadsList$: Observable<SubscriptionUploads[] | null> = this.channelUploadsListSubject.asObservable();

    constructor(private youtubeService: YoutubeService,
        private http: HttpClient
    ){
        if(this.initialized) return;
        this.initialized = true;

        this._channelIdList = this.getSubscriptionList();

        for(let channel = 0; channel < this._channelIdList.length; channel++){
            this.addToSubscriptionList(this.channelIdList[channel]);
        }
    }

    get channelIdList(): string[]{
        return this._channelIdList;
    }

    get allSubscriptions(): SubscriptionData[]{
        return this._allSubscriptions
    }

    public addToSubscriptionList(channelId: string): void{
        
        this.youtubeService.getFullChannel(channelId)
                    .pipe(take(1))
                    .subscribe(data => {
                        let uploadsId = data.uploadsId;
                        let iconUrl = data.iconUrl;

                        let subcription: SubscriptionData = {channelId: channelId, uploadsId: uploadsId, iconUrl: iconUrl, initialized: false}
                        this._allSubscriptions.push(subcription);
                        this.channelDataListSubject.next(this._allSubscriptions);
                    });
    }

    public initializeChannelUploads(channel: SubscriptionData): void{
        if(channel.initialized) return;
        channel.initialized = true;

        if(!channel) return;

        let nextPageToken = '';
        this.youtubeService.getPlaylistVideos(channel.uploadsId, nextPageToken)
        .pipe(take(1))
        .subscribe(uploads => {
            let subcriptionUploads: SubscriptionUploads = {uploadsId: channel.uploadsId, uploads: uploads.results, nextPageToken: uploads.nextPageToken, isLoadingUploads: false};
            for(let video = 0; video < uploads.results.length; video++){
                uploads.results[video].channelThumbnailUrl = channel.iconUrl;
            }
            this._allChannelUploads.push(subcriptionUploads);
            this.channelUploadsListSubject.next(this._allChannelUploads);
        });
    }

    public isLastLoadedUpload(playlistId: string, videoId: string): boolean{
        for(let channel = 0; channel < this.allSubscriptions.length; channel++){
            if(this._allChannelUploads[channel].uploadsId === playlistId){
                return this._allChannelUploads[channel].uploads[this._allChannelUploads[channel].uploads.length - 1].id === videoId;
            }
        }
        return false;
    }

    public loadMoreUploads(playlistId: string): void{
        for(let channel = 0; channel < this.allSubscriptions.length; channel++){
            if(this._allChannelUploads[channel].uploadsId === playlistId){
                if(this._allChannelUploads[channel].isLoadingUploads) return;
                if(!this._allChannelUploads[channel].nextPageToken) return;
                this._allChannelUploads[channel].isLoadingUploads = true;   

                this.youtubeService.getPlaylistVideos(playlistId, this._allChannelUploads[channel].nextPageToken)
                    .pipe(take(1))
                    .subscribe(uploads => {
                        for(let video = 0; video < uploads.results.length; video++){
                            this._allChannelUploads[channel].uploads.push(uploads.results[video]);
                        }
                        this._allChannelUploads[channel].nextPageToken = uploads.nextPageToken;
                        this._allChannelUploads[channel].isLoadingUploads = false;
                        this.channelUploadsListSubject.next(this._allChannelUploads);
                    });
            }
        }
    }

    public conditionalAddTosubscriptionList(channelId: string): void{
        for(let i = 0; i < this._allSubscriptions.length; i++){
            if(this._allSubscriptions[i].channelId == channelId) return;
        }

        this.addToSubscriptionList(channelId);
    }

    public subscribeToChannel(channelId: string): void{
        if(!this._channelIdList) this._channelIdList = [];
        if(this.isSubscribed(channelId)) return;

        this.conditionalAddTosubscriptionList(channelId);

        this._channelIdList.push(channelId);
        this.saveSubscriptionList();
    }

    public unsubscribeToChannel(channelId: string): void{
        if(!this.channelIdList) return;
        this._channelIdList = this._channelIdList.filter(element => element !== channelId);

        this._allSubscriptions = this._allSubscriptions.filter(subscription => {
            if(subscription.channelId === channelId) {
                for(let channel = 0; channel < this._allChannelUploads.length; channel++){
                    if(this._allChannelUploads[channel].uploadsId === subscription.uploadsId) {
                        this._allChannelUploads.splice(channel, 1);
                        this.channelUploadsListSubject.next(this._allChannelUploads);
                        break;
                    }
                }
                return false;
            }
            return true;
        });
        this.channelDataListSubject.next(this._allSubscriptions);
        this.saveSubscriptionList();
    }

    saveSubscriptionList(): void{
        if(!this.channelIdList) return;
        localStorage.setItem(this.SUBSCRIPTION_LIST_KEY, JSON.stringify(this._channelIdList));
    }

    public getSubscriptionList(): string[]{
        if(this.youtubeService.loginSessionId) return [];
        let list = JSON.parse(localStorage.getItem(this.SUBSCRIPTION_LIST_KEY));
        if(!list) return [];
        return list;
    }


    public isSubscribed(channelId: string): boolean{
        if(!this.channelIdList) return false;
        return this.channelIdList.includes(channelId);
    }
}


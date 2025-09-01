import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { Router } from '@angular/router';
import { YouTubeSearchResponse, SearchResultItem } from './video-search-result.model';
import { YouTubeChannel } from './youtube-channel-search-results.model';
import { take } from 'rxjs/operators';
import { FullVideoData, PlaylistVideo } from './youtube-playlist-results.model';
import { WatchHistoryService } from './watch-history.service';

@Injectable({
  providedIn: 'root'
})
export class YoutubeService {
    private loginSessionIdSubject = new BehaviorSubject<string | null>(null);
    loginSessionId$: Observable<string | null> = this.loginSessionIdSubject.asObservable();
    private loginImageSubject = new BehaviorSubject<string | null>(null);
    loginImage$: Observable<string | null> = this.loginImageSubject.asObservable();

    private _currentSearchQuery: string;
    private nextSearchPageToken: string;
    private searchList: SearchResultItem[];
    private searchResultsSubject = new BehaviorSubject<SearchResultItem[] | null>(null);
    searchResults$: Observable<SearchResultItem[] | null> = this.searchResultsSubject.asObservable();
    private searchSuggestionsSubject = new BehaviorSubject<string[] | null>(null);
    searchSuggestions$: Observable<string[] | null> = this.searchSuggestionsSubject.asObservable();

    private fullPlayingVideoDataSubject = new BehaviorSubject<FullVideoData | null>(null);
    fullPlayingVideoData$: Observable<FullVideoData | null> = this.fullPlayingVideoDataSubject.asObservable();
    private videoIdSubject = new BehaviorSubject<string | null>(null);
    videoId$: Observable<string | null> = this.videoIdSubject.asObservable();
    private minimizedSubject = new BehaviorSubject<boolean | null>(null);
    videoMinimized$: Observable<boolean | null> = this.minimizedSubject.asObservable();
    private videoWidthSubject = new BehaviorSubject<number | null>(null);
    videoWidth$: Observable<number | null> = this.videoWidthSubject.asObservable();
    private videoYSubject = new BehaviorSubject<number | null>(null);
    videoY$: Observable<number | null> = this.videoYSubject.asObservable();

    private channelSubject = new BehaviorSubject<YouTubeChannel | null>(null);
    channel$: Observable<YouTubeChannel | null> = this.channelSubject.asObservable();
    private uploadsPageToken: string;
    private channelUploadList: PlaylistVideo[];
    private channelUploadsSubject = new BehaviorSubject<PlaylistVideo[] | null>(null);
    channelUploads$: Observable<PlaylistVideo[] | null> = this.channelUploadsSubject.asObservable();

    constructor(private http: HttpClient,
        private router: Router,
        private watchHistoryService: WatchHistoryService
    ) { }

    searchVideos(query: string, nextPageToken: string): Observable<any> {
        let params = new HttpParams()
            .set('q', query)
            .set('nextPageToken', nextPageToken);

        return this.http.get<YouTubeSearchResponse>(`/youtube_search`, { params });
    }

    getFullSearchSuggestions(query: string): Observable<any> {
        let params = new HttpParams()
            .set('q', query);

        return this.http.get<string[]>(`/youtube_get_search_suggestions`, { params });
    }

    getFullChannel(id: string): Observable<any>{
        let params = new HttpParams()
            .set('id', id);

        return this.http.get<YouTubeChannel>(`/youtube_full_channel`, { params });
    }

    getPlaylistVideos(id: string, nextPageToken: string): Observable<any>{
        let params = new HttpParams()
            .set('id', id)
            .set('nextPageToken', nextPageToken);

        return this.http.get<YouTubeSearchResponse>(`/youtube_get_playlist_videos`, { params });
    }

    getFullVideoData(videoId: string): Observable<any>{
        let params = new HttpParams()
            .set('videoId', videoId);

        return this.http.get<FullVideoData>(`/youtube_get_video_data`, { params });
    }

    youtubeInitializeLogin(): Observable<any>{
        let params = new HttpParams();
        console.log('logging');

        return this.http.get<any>(`/start_youtube_login`, { params });
    }

    startLoginStream(id: string): Observable<any>{
        let params = new HttpParams();
        console.log('streaming');

        return this.http.get<Blob>(`/stream_youtube_login/${id}`, { params, responseType: 'blob' as 'json' });
    }

    isLoginSessionActive(id: string): Observable<any>{
        let params = new HttpParams();

        return this.http.get<any>(`/is_session_active/${id}`, { params });
    }

    get isDisplayingVideo(): boolean{
        return this.videoIdSubject.value ? true : false;
    }

    get isMinimized(): boolean{
        return this.minimizedSubject.value;
    }

    set currentSearchQuery(search: string){
        this._currentSearchQuery = search;
    }

    set videoPlayerWidth(number: number){
        this.videoWidthSubject.next(number);
    }

    set videoPlayerY(number: number){
        this.videoYSubject.next(number);
    }

    set channel(channel: YouTubeChannel){
        this.channelSubject.next(channel);
    }

    youtubeFullLogin(): void{
        let id;
        this.youtubeInitializeLogin()
        .pipe(take(1))
        .subscribe(data => {
            id = data.id
            console.log(data);
            this.loginSessionIdSubject.next(id);

            this.makeLoginStream(id);
        });
    }

    makeLoginStream(id: string): void{
        
        let sessionChecker = setInterval(() => {
            this.isLoginSessionActive(id)
                .pipe(take(1))
                .subscribe(isReady => {
                    if(!isReady) return;

                    clearInterval(sessionChecker);
                    this.startLoginStream(id)
                        .pipe(take(1))
                        .subscribe(data => {
                            const objectUrl = URL.createObjectURL(data);
                            this.loginImageSubject.next(objectUrl);
                });
            });
        }, 500);

        
    }

    public minimizePlayer(){
        this.minimizedSubject.next(true);
    }

    public expandPlayer(){
        this.minimizedSubject.next(false);
    }

    public playNewVideo(video: PlaylistVideo):void{
        let videoId = video.id;

        if(!this.isMinimized) {
            this.navigateToPlayer();
        }else{
            if(this.videoIdSubject.value == videoId) {
                this.navigateToPlayer();
                this.expandPlayer();
                return;
            }
        }
        this.videoIdSubject.next(videoId);
        this.watchHistoryService.saveCurrentVideo(video);

        this.getFullVideoData(videoId)
            .pipe(take(1))
            .subscribe(data => {
                this.fullPlayingVideoDataSubject.next(data);
        });
    }

    public removeVideoPlaying(): void{
        this.videoIdSubject.next('');
    }

    getSearchSuggestions(query: string): void{
        let results;
        this.getFullSearchSuggestions(query)
            .pipe(take(1))
            .subscribe(data => {
                results = data;
                results = results.splice(0,5);
                this.searchSuggestionsSubject.next(results);
        });
    }

    saveNextSearchToken(token: string): void{
        this.nextSearchPageToken = token;
    }

    replaceSearchList(list :SearchResultItem[]):void{
        this.searchList = list;
        this.searchResultsSubject.next(this.searchList);
    }

    searchForVideos(query: string): void{
        this.searchVideos(query, '')
            .pipe(take(1))
            .subscribe(data => {
                this.replaceSearchList(data.results);
                this.saveNextSearchToken(data.nextPageToken);
        });
    }

    addToSearchList(): void{
        this.searchVideos(this.currentSearchQuery, this.nextSearchPageToken)
            .pipe(take(1))
            .subscribe(data => {
                for(let video = 0; video < data.results.length; video++){
                    this.searchList.push(data.results[video]);
                }
                this.searchResultsSubject.next(this.searchList);
                this.saveNextSearchToken(data.nextPageToken);
        });
    }

    saveCurrentChannel(channel: YouTubeChannel){
        this.channelSubject.next(channel);
    }

    saveUploadsPageToken(token: string):void{
        this.uploadsPageToken = token;
    }

    replaceChannelUploadList(list :PlaylistVideo[]){
        this.channelUploadList = list;
        this.channelUploadsSubject.next(this.channelUploadList);
    }

    addToUploadList(): void{
        if(!this.uploadsPageToken) return;
        this.getPlaylistVideos(this.channelSubject.value.uploadsId, this.uploadsPageToken)
            .pipe(take(1))
            .subscribe(uploads => {
                this.saveUploadsPageToken(uploads.nextPageToken);
                this.channelUploadList.push(...uploads.results);
                this.channelUploadsSubject.next(this.channelUploadList);
            });
        
    }

    public navigateToChannel(channelId: string): void {
        if(!channelId) return;

        this.getFullChannel(channelId)
            .pipe(take(1))
            .subscribe(data => {
                this.saveCurrentChannel(data);
        
                let nextPageToken = '';
                this.getPlaylistVideos(data.uploadsId, nextPageToken)
                .pipe(take(1))
                .subscribe(uploads => {
                    this.saveUploadsPageToken(uploads.nextPageToken);
                    this.replaceChannelUploadList(uploads.results);
                });
            });

        this.router.navigate(['/youtube', { 
            outlets: { 
                youtube: ['channel-view'] 
            } 
        }], { skipLocationChange: true });
    }

    public navigateToPlayer(): void {
        this.router.navigate(['/youtube', { 
            outlets: { 
                youtube: ['player'] 
            } 
        }], { skipLocationChange: true });

    }

    public timeAgo(isoDate) {
        const now = new Date();
        const past = new Date(isoDate);
        const diffMs = now.getTime() - past.getTime();

        if (diffMs < 0) return "in the future";

        const seconds = Math.floor(diffMs / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        const months = Math.floor(days / 30);
        const years = Math.floor(days / 365);

        if (years > 0) return years === 1 ? "1 year ago" : `${years} years ago`;
        if (months > 0) return months === 1 ? "1 month ago" : `${months} months ago`;
        if (days > 0) return days === 1 ? "1 day ago" : `${days} days ago`;
        if (hours > 0) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
        if (minutes > 0) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
        if (seconds > 0) return seconds === 1 ? "1 second ago" : `${seconds} seconds ago`;

        return "just now";
    }

    formatVideoDuration(totalSeconds: number): string {
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
        const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
        return `${hours}:${minutes}:${seconds}`;
    }
}


export interface VideoHistory{
    length: number;
    currentPosition: number;
    watchedAt: string;
    videoThumbnailUrl: string;
    title: string;
    channelTitle: string;
    channelId: string;
    channelThumbnailUrl: string;
}

export interface HistoryVideo{
    id: string;
    videoData: VideoHistory;
}
export interface Playlist{
    name: string;
    list: PlaylistVideo[];
    nextPageToken: string
}

export interface PlaylistVideo{
  id: string;
  title: string;
  duration: string;
  channelId: string;
  channelTitle: string;
  viewCount: string;
  channelThumbnailUrl: string;
  videoThumbnailUrl: string
  description: string
  uploadDate: string;
}

export interface FullVideoData{
  basicVideoData: PlaylistVideo;
  relatedVideos: PlaylistVideo[];
  channelSubs: string;
}
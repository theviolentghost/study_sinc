import { PlaylistVideo } from "./youtube-playlist-results.model";

export interface YouTubeChannel {
  channelId: string;
  uploadsId: string;
  name: string;
  tag: string;
  description: string;
  iconUrl: string;
  bannerUrl: string;
  
}

export interface SubscriptionData{
  channelId: string;
  uploadsId: string;
  iconUrl: string;
  initialized: boolean;
}

export interface SubscriptionUploads{
  uploadsId: string;
  uploads: PlaylistVideo[];
  nextPageToken: string;
  isLoadingUploads: boolean;
}

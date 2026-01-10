
export interface SearchResultItem {
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

export interface YouTubeSearchResponse {
  results: SearchResultItem[];
}
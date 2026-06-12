
import 'dotenv/config';

import youtubeAccount from './youtube-account.js';

async function getVideoData(videoId){
  let yt = youtubeAccount.getAccountInstance('');
  let data;
  try{
    data = await yt.getInfo(videoId);
  }catch{
    console.log('error getting youtubi video data');
    return null;
  }
  
  let basicVideoData;
  try{
    basicVideoData = {
      id: data.basic_info?.id || '',
      title: data.basic_info?.title || '',
      duration: data.basic_info?.duration || '',
      channelId: data.basic_info?.channel_id || '',
      channelTitle: data.basic_info?.author || '',
      viewCount: data.primary_info?.view_count?.short_view_count?.text || '',
      channelThumbnailUrl: data.secondary_info?.owner?.author?.thumbnails?.[0]?.url || '',
      videoThumbnailUrl: data.basic_info?.thumbnail?.[0]?.url || '',
      description: data.secondary_info?.description?.text || '',
      uploadDate: data.primary_info?.published?.text || '',
    };
  }catch(err){
    return;
  }
  let channelSubs = data.secondary_info.owner.subscriber_count.text;

  let nextVideosData = data.watch_next_feed;
  let nextVideos = [];
  for(let video = 0; video < nextVideosData.length; video++){
    let videoData = data.watch_next_feed[video];
    if(videoData.content_type !== 'VIDEO') continue;
    
    try{
      let videoObject = {
        id: videoData.content_id,
        title: videoData.metadata?.title?.text || '',
        duration: videoData.content_image?.overlays?.[0]?.badges?.[0]?.text || '',
        channelId: videoData.metadata?.image?.renderer_context?.command_context?.on_tap?.payload?.browseId || '',
        channelTitle: videoData.metadata?.metadata?.metadata_rows?.[0]?.metadata_parts?.[0]?.text?.text || '',
        viewCount: videoData.metadata?.metadata?.metadata_rows?.[1]?.metadata_parts?.[0]?.text?.text || '',
        channelThumbnailUrl: videoData.metadata?.image?.avatar?.image?.[0]?.url || '',
        videoThumbnailUrl: videoData.content_image?.image?.[0]?.url || '',
        description: '',
        uploadDate: videoData.metadata?.metadata?.metadata_rows?.[1]?.metadata_parts?.[1]?.text?.text || '',
      };
      nextVideos.push(videoObject);
    }catch(err){
      return;
    }
  }

  return {basicVideoData: basicVideoData, relatedVideos: nextVideos, channelSubs: channelSubs};
} 

async function getPlaylistVideos(playlistId, nextPageToken) {
  let yt = youtubeAccount.getAccountInstance('');
  let playlistData;
  let results = [];
  let newNextPageToken = '';

  if (!nextPageToken) {
    playlistData = await yt.actions.execute('/browse', {
      browseId: 'VL' + playlistId
    });

    results = playlistData?.data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];
    
    let lastItem = results.at(-1);
    newNextPageToken = lastItem?.continuationItemRenderer?.continuationEndpoint?.commandExecutorCommand?.commands?.[1]?.continuationCommand?.token 
      || lastItem?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token 
      || '';

  } else {
    playlistData = await yt.actions.execute('/browse', {
      continuation: nextPageToken
    });
    
    results = playlistData?.data?.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuationItems || [];
    
    let lastItem = results.at(-1);
    newNextPageToken = lastItem?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || '';
  }

  let videos = [];

  for (let video = 0; video < results.length; video++) {
    try {
      let videoData = results[video]?.lockupViewModel;
      
      if (!videoData) continue; 

      let sources = videoData.contentImage?.thumbnailViewModel?.image?.sources || [];
      let metadataRows = videoData.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
      
      // Look through the second metadata row (index 1) for views and upload dates
      let viewCountText = '';
      let uploadDateText = '';
      
      if (metadataRows[1]?.metadataParts) {
        const parts = metadataRows[1].metadataParts;
        if (parts.length >= 2) {
          viewCountText = parts[0]?.text?.content || '';
          uploadDateText = parts[1]?.text?.content || '';
        } else if (parts.length === 1) {
          const content = parts[0]?.text?.content || '';
          if (content.includes('ago') || content.includes('Streamed') || content.includes('just now')) {
            uploadDateText = content;
          } else {
            viewCountText = content;
          }
        }
      }

      let videoObject = {
        id: videoData.contentId || '',
        channelId: videoData.metadata?.lockupMetadataViewModel?.image?.decoratedAvatarViewModel?.rendererContext?.commandContext?.onTap?.innertubeCommand?.browseEndpoint?.browseId || '',
        uploadDate: uploadDateText,
        title: videoData.metadata?.lockupMetadataViewModel?.title?.content || '',
        description: '', 
        viewCount: viewCountText,
        videoThumbnailUrl: sources.length > 0 ? sources[sources.length - 1].url : '',
        duration: videoData.contentImage?.thumbnailViewModel?.overlays?.[0]?.thumbnailBottomOverlayViewModel?.badges?.[0]?.thumbnailBadgeViewModel?.text || null,
      };

      videos.push(videoObject);
    } catch (err) {
      console.error("Failed parsing a video block item context:", err);
      continue;
    }
  }

  return { results: videos, nextPageToken: newNextPageToken };
}

export default{
  getVideoData: getVideoData,
  getPlaylistVideos: getPlaylistVideos,
}


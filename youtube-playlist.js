
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

async function getPlaylistVideos(playlistId, nextPageToken){
  let yt = youtubeAccount.getAccountInstance('');
  let playlistData;
  let results;
  let newNextPageToken;
  if(!nextPageToken){
    playlistData = await yt.actions.execute('/browse', {
      browseId: 'VL' + playlistId
    });
    results = playlistData.data.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.sectionListRenderer.contents[0].itemSectionRenderer.contents[0].playlistVideoListRenderer.contents;
    newNextPageToken = results.at(-1).continuationItemRenderer?.continuationEndpoint.commandExecutorCommand.commands[1].continuationCommand.token || '';
  }else{
    playlistData = await yt.actions.execute('/browse', {
      continuation: nextPageToken
    });
    results = playlistData.data.onResponseReceivedActions[0].appendContinuationItemsAction.continuationItems;
    newNextPageToken = results.at(-1).continuationItemRenderer?.continuationEndpoint.continuationCommand.token || '';
  }

  let videos = [];

  for(let video = 0; video < results.length; video++){
    try{
      let videoObject = {
        id: results[video].playlistVideoRenderer.videoId,
        channelId: results[video].playlistVideoRenderer.shortBylineText.runs[0].navigationEndpoint.browseEndpoint.browseId,
        uploadDate: results[video].playlistVideoRenderer.videoInfo.runs[2].text,
        title: results[video].playlistVideoRenderer.title.runs[0].text,
        description: '',
        viewCount: results[video].playlistVideoRenderer.videoInfo.runs[0].text,
        videoThumbnailUrl: results[video].playlistVideoRenderer.thumbnail.thumbnails[results[video].playlistVideoRenderer.thumbnail.thumbnails.length -1].url,
        duration: results[video].playlistVideoRenderer.lengthText?.simpleText || null,

      };
      videos.push(videoObject);
    }catch(err){
      continue;
    }
  }

  return {results: videos, nextPageToken: newNextPageToken};
}

export default{
  getVideoData: getVideoData,
  getPlaylistVideos: getPlaylistVideos,
}


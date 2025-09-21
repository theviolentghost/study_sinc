
import 'dotenv/config';
import { Innertube } from 'youtubei.js';
import youtubeAccount from './youtube-account.js';

const yt = await Innertube.create();

async function search(query, nextPageToken, accountId) {
    if (!query || query.trim() === '') {
        console.error('Query must be a non-empty string');
        return {
            results: [],
            nextPageToken: null
        };
    }

    try {
        return await youtubeSearch(query, nextPageToken, accountId);
    } catch (error) {
        console.error('Error searching YouTube:', error);
        return { 
            results: [],
            nextPageToken: null
        };
    }
}

async function youtubeSearch(query, nextPageToken, accountId) {
  let yt = youtubeAccount.getAccountInstance(accountId);
  let searchData;
  let results;
  let newNextPageToken;
  if(!nextPageToken){
    searchData = await yt.actions.execute('/search', {
      query: query
    });
    results = searchData?.data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[0].itemSectionRenderer.contents;
    if(!results.length) return;
    newNextPageToken = searchData.data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer?.contents[1]?.continuationItemRenderer.continuationEndpoint.continuationCommand.token || '';
  }else{
    searchData = await yt.actions.execute('/search', {
      continuation: nextPageToken
    });
    results = searchData?.data.onResponseReceivedCommands?.[0]?.appendContinuationItemsAction.continuationItems[0].itemSectionRenderer.contents;
    if(!results.length) return;
    newNextPageToken = searchData.data.onResponseReceivedCommands[0]?.appendContinuationItemsAction.continuationItems[1]?.continuationItemRenderer.continuationEndpoint.continuationCommand.token || '';
  }

  let returnResults = [];
  for(let result = 0; result < results.length; result++){

    let channelData = results[result]?.channelRenderer;
    let videoData = results[result]?.videoRenderer;
    if(!channelData && !videoData) continue;

    let returnObject = {
      id: null,
      title: null,
      channelTitle: null,
      channelId: null,
      duration: null,
      viewCount: null,
      uploadDate: null,
      videoThumbnailUrl: null,
      channelThumbnailUrl: null,
      description: null
    };

    try{
      if(channelData){
        returnObject.id = channelData.channelId;
        returnObject.title = channelData.title.simpleText;
        returnObject.channelTitle = channelData.subscriberCountText.simpleText;
        returnObject.channelId = channelData.channelId;
        returnObject.channelThumbnailUrl = channelData.thumbnail.thumbnails[channelData.thumbnail.thumbnails.length - 1].url;
        returnObject.viewCount = channelData.videoCountText.simpleText;
      }
      if(videoData){
        returnObject.id = videoData.videoId;
        returnObject.title = videoData.title.runs[0].text;
        returnObject.channelTitle = videoData.ownerText.runs[0].text;
        returnObject.channelId = videoData.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer.navigationEndpoint.browseEndpoint.browseId;
        returnObject.channelThumbnailUrl = videoData.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer.thumbnail.thumbnails[0].url;
        returnObject.videoThumbnailUrl = videoData.thumbnail.thumbnails[videoData.thumbnail.thumbnails.length - 1].url;
        returnObject.duration = videoData.lengthText.simpleText;
        returnObject.viewCount = videoData.shortViewCountText.simpleText;
        returnObject.uploadDate = videoData.publishedTimeText.simpleText;
        returnObject.description = videoData.detailedMetadataSnippets?.[0]?.snippetText?.runs[0]?.text || '';
      }
    }catch(err){
      continue;
    }
    returnResults.push(returnObject);
  }
  return {results: returnResults, nextPageToken: newNextPageToken};
}

async function getSearchSuggestions(query) {
  let suggestions = await yt.getSearchSuggestions(query);
  return suggestions;
}

export default {
  getSearchSuggestions: getSearchSuggestions,
  search: search,
};
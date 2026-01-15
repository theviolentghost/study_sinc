
import youtubeAccount from './youtube-account.js';

async function getHomepage(accountId, nextPageToken){
    let yt = youtubeAccount.getAccountInstance(accountId);

    let homepageData;
    try{
        if(!nextPageToken){
            homepageData = await yt.actions.execute('/browse', {
                browseId: 'FEwhat_to_watch'
            });
        } else {
            homepageData = await yt.actions.execute('/browse', {
                continuation: nextPageToken
            });
        }
    }catch(err){
        console.error("failed to fetch youtube homepage");
        console.error(err);
    }
    
    let isLoggedOut = homepageData.data.responseContext.mainAppWebResponseContext.loggedOut;
    if(isLoggedOut) return;

    let results
    if(!nextPageToken){
        results = homepageData.data.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer.contents;
    }else{
        results = homepageData.data.onResponseReceivedActions[0].appendContinuationItemsAction.continuationItems;
    }
    let videoData = [];
    for(let result = 0; result < results.length; result++){
        let videoId = results[result].richItemRenderer?.content?.lockupViewModel?.contentId;
        if(!videoId) continue;
        videoData.push(videoId);
    }
    let newNextPageToken = results[results.length - 1].continuationItemRenderer.continuationEndpoint.continuationCommand.token;

    return {data: videoData, nextPageToken: newNextPageToken};
}

export default{
    getHompage: getHomepage,
}
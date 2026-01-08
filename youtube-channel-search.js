
import 'dotenv/config';

import youtubeAccount from './youtube-account.js';

async function getFullChannelDetails(channelId){
    let yt = youtubeAccount.getAccountInstance('');
    const channelData = await yt.getChannel(channelId);
    return {
        channelId: channelId,
        uploadsId: 'UU' + channelId.substring(2),
        name: channelData.header.page_title,
        tag: channelData.current_tab.endpoint.payload.canonicalBaseUrl.substring(1),
        description: channelData.metadata.description,
        iconUrl: channelData.header.content.image.avatar.image[0].url,
        bannerUrl: channelData.header.content.banner.image[0].url,
    };
}

async function getFullChannel(id){
    if (!id || id.trim() === '') {
        console.error('id must be a non-empty string');
        return null;
    }

    try {
        return await getFullChannelDetails(id);
    } catch (error) {
        console.error('Error searching YouTube channel:', error);
        return null;
    }
}

export default{
    getFullChannel: getFullChannel,
};
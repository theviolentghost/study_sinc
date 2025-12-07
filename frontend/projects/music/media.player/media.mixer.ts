import { MusicMediaService } from '../music.media.service';
import { MusicPlayerService } from '../music.player.service';

export interface Mix_Data {
    success: boolean,
    mix_id: string,
    playlist_url: string,
    mix_info: any,
    cached: boolean
}

export interface Mix_Data_Parameters {
    mixing_strategy: string;
}

class MediaMixer {
    // vv video ids
    private song_out_id: string = ''; //current
    private song_in_id: string = ''; //next
    private current_mix_data: Mix_Data | null = null;

    constructor(private media: MusicMediaService) {
        
    }

    public async get_mix_data(video_1_id: string, video_2_id: string, parameters: Mix_Data_Parameters): Promise<Mix_Data | null> {
        const mix_data = await this.media.request_mix(video_1_id, video_2_id, parameters);
        this.current_mix_data = mix_data;
        return mix_data;
    }

    public set_song_ids(out_id: string, in_id: string): void {
        this.song_out_id = out_id;
        this.song_in_id = in_id;
    }

    public async mix_and_load_into_player(player: MusicPlayerService): Promise<void> {
        await this.get_mix_data(this.song_out_id, this.song_in_id, { mixing_strategy: 'balanced' });
        console.log('Mix data received:', this.current_mix_data);
        if (!this.current_mix_data || !this.current_mix_data.success) {
            console.error('Failed to get mix data');
            return;
        }
        // clear already buffered data beyond mix out time to allow smooth transition
        await player.buffer_controller.slice_buffer(
            Math.floor((this.current_mix_data.mix_info.mix_out_time || 0) / this.current_mix_data.mix_info.segment_duration) * this.current_mix_data.mix_info.segment_duration,
            Infinity
        );
        return player.buffer_controller.load_and_play(this.current_mix_data.playlist_url, true, false);
    }
}

export default MediaMixer;
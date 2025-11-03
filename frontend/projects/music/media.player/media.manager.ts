import MusicPlaylistManager from "./playlist.manager";
import BufferController from "./buffer.controller";

class MusicMediaManager {
    private playlist_manager: MusicPlaylistManager;
    private buffer_controller: BufferController;

    constructor() {
        this.playlist_manager = new MusicPlaylistManager();
        this.buffer_controller = new BufferController();
    }

    public play(): void {
        // this.buffer_controller.play();
    }

    public pause(): void {
        // this.buffer_controller.pause();
    }

    public toggle_play(): void {
        // if (this.buffer_controller.is_playing) {
        //     this.pause();
        // } else {
        //     this.play();
        // }
    }

    private configure_media_session() {
        // if (!('mediaSession' in navigator)) return;

        // navigator.mediaSession.setActionHandler('play', () => {
        //     this.audio_element?.play();
        // });
        
        // navigator.mediaSession.setActionHandler('pause', () => {
        //     this.audio_element?.pause();
        // });

        // navigator.mediaSession.setActionHandler('nexttrack', () => {
        //     this.next_track();
        // });
    }
}

export default MusicMediaManager;
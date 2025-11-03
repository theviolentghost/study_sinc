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
}

export default MusicMediaManager;
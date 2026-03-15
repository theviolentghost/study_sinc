"""
Transcription Worker - Lyrics transcription
Handles: Whisper-based lyrics transcription with word-level timestamps
Heavy ML model - slow startup but specialized for transcription tasks
"""

from flask import Flask, request, jsonify
import sys
import os
import logging
import signal
import traceback
from functools import wraps

# Configure logging
logging.basicConfig(
    level=logging.WARNING,
    format='%(asctime)s %(levelname)s %(name)s %(threadName)s : %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# Initialize transcription components (slow startup)
print("🔄 Loading Whisper transcription model...")
try:
    from music.lyrics_generator import Lyrics_Transcriber
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'music', 'recommendation'))
    from hls_audio_decoder import HLS_Audio_Decoder
    
    lyrics_transcriber = Lyrics_Transcriber()
    decoder = HLS_Audio_Decoder()
    TRANSCRIPTION_AVAILABLE = True
    print("✅ Whisper model loaded successfully")
except ImportError as e:
    print(f"❌ Lyrics transcription not available: {e}")
    TRANSCRIPTION_AVAILABLE = False
    lyrics_transcriber = None
    decoder = None

app = Flask(__name__)

# Global error handler decorator
def handle_errors(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except Exception as e:
            logger.error(f"Error in {f.__name__}: {str(e)}")
            logger.error(f"Traceback: {traceback.format_exc()}")
            return jsonify({
                "error": "Internal server error",
                "message": str(e),
                "endpoint": f.__name__
            }), 500
    return decorated_function

# Health check endpoint
@app.route('/health')
@handle_errors
def health():
    return jsonify({
        "status": "healthy",
        "worker_type": "transcription",
        "transcription_available": TRANSCRIPTION_AVAILABLE,
        "timestamp": os.popen('date').read().strip()
    })

# Global error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found"}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed"}), 405

@app.errorhandler(500)
def internal_server_error(error):
    logger.error(f"Internal server error: {str(error)}")
    return jsonify({"error": "Internal server error"}), 500

# Signal handlers for graceful shutdown
def signal_handler(signum, frame):
    logger.info(f"Received signal {signum}, shutting down gracefully...")
    sys.exit(0)

signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)

# ============================================================================
# TRANSCRIPTION ENDPOINTS
# ============================================================================

@app.route('/transcribe_lyrics', methods=['POST'])
@handle_errors
def transcribe_lyrics():
    """
    Transcribe lyrics from audio with word-level timestamps
    
    Request body:
    {
        "video_id": "youtube_video_id",
        "audio_path": "/path/to/audio.mp3" (optional),
        "silence_threshold": 6.5 (optional, seconds)
    }
    
    Response:
    {
        "success": true,
        "video_id": "...",
        "info": {
            "source": "musik",
            "duration": 180000,
            "language_probabilities": [...]
        },
        "blocks": [
            {
                "start_time": 0,
                "end_time": 2500,
                "text": "Lyric line",
                "probability": 0.95
            }
        ]
    }
    """
    if not TRANSCRIPTION_AVAILABLE:
        return jsonify({
            'success': False,
            'error': 'Transcription service not available'
        }), 503
    
    try:
        data = request.get_json()
        video_id = data.get('video_id')
        audio_path = data.get('audio_path')
        silence_threshold = data.get('silence_threshold', 6.5)
        
        if not video_id and not audio_path:
            return jsonify({
                'success': False,
                'error': 'Either video_id or audio_path is required'
            }), 400
        
        print(f"Transcribing lyrics for video_id: {video_id}")
        
        # Determine audio input
        sample_rate = 44100  # Default sample rate
        if audio_path:
            audio_input = audio_path
            # For file paths, let Whisper auto-detect sample rate
            sample_rate = None
            print(f"Using audio file path: {audio_path}")
        elif video_id:
            # Try to decode from HLS
            try:
                audio_input, sample_rate = decoder.decode_chunks_to_numpy(video_id, 'high')
                print(f"Decoded audio from HLS: shape={audio_input.shape}, sample_rate={sample_rate}Hz, silence_threshold={silence_threshold}s")
            except Exception as e:
                print(f"Could not decode from HLS: {e}")
                return jsonify({
                    'success': False,
                    'error': f'Could not find audio for video_id: {video_id}'
                }), 404
        
        # Transcribe
        if sample_rate:
            lyrics = lyrics_transcriber.transcribe(
                audio_input, 
                original_sample_rate=sample_rate, 
                silence_threshold=silence_threshold
            )
        else:
            # For file paths, don't pass sample_rate
            lyrics = lyrics_transcriber.transcribe(audio_input, silence_threshold=silence_threshold)
        lyrics_json = lyrics.to_json()
        print("Transcription result:")
        print(lyrics_json)
        
        # Convert to JSON-serializable format
        result = {
            'success': True,
            'video_id': video_id,
            'info': lyrics_json['info'],
            'blocks': lyrics_json['blocks'],
            'lyrics': lyrics_json['lyrics']
        }

        return jsonify(result)
        
    except Exception as e:
        print(f"Error transcribing lyrics: {e}")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Application entry point
if __name__ == '__main__':
    try:
        port = int(os.getenv('FLASK_PORT', 5003))
        worker_name = os.getenv('WORKER_NAME', 'Transcription Worker')
        worker_cores = os.getenv('WORKER_CORES', '2')
        
        logger.info(f"Starting Flask server: {worker_name}")
        logger.info(f"Port: {port}, Cores: {worker_cores}")
        
        app.run(debug=False, host='0.0.0.0', port=port, threaded=True)
    except Exception as e:
        logger.error(f"Failed to start server: {str(e)}")
        sys.exit(1)

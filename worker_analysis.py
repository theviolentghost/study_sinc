"""
Analysis Worker - Audio analysis and DJ mixing
Handles: Audio embeddings, similarity search, DJ mix calculations
Heavy ML models - slow startup but specialized for analysis tasks
"""

from flask import Flask, request, jsonify
import sys
import os
import logging
import signal
import traceback
from functools import wraps
from song_analyzer import *

# Configure logging
logging.basicConfig(
    level=logging.WARNING,
    format='%(asctime)s %(levelname)s %(name)s %(threadName)s : %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# Initialize audio analysis components (slow startup)
print("🔄 Loading audio analysis models...")
# try:
#     sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'music', 'recommendation'))
#     from query_2 import Audio_Search
#     from hls_audio_decoder import HLS_Audio_Decoder
#     from analysis_2 import DJ_Audio_Analyzer, DJ_Mix_Calculator
#     from dj_mixer import DJ_Audio_Mixer

#     # Initialize components
#     decoder = HLS_Audio_Decoder()
#     analyzer = DJ_Audio_Analyzer()
#     mix_calculator = DJ_Mix_Calculator()
#     mixer = DJ_Audio_Mixer()
#     audio_search = Audio_Search()

#     AUDIO_SEARCH_AVAILABLE = True
#     print("✅ Audio analysis models loaded successfully")
# except ImportError as e:
#     print(f"❌ Audio analysis module not available: {e}")
#     AUDIO_SEARCH_AVAILABLE = False
#     decoder = None
#     analyzer = None
#     mix_calculator = None
#     mixer = None
#     audio_search = None

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

# # Health check endpoint
# @app.route('/health')
# @handle_errors
# def health():
#     return jsonify({
#         "status": "healthy",
#         "worker_type": "analysis",
#         "audio_search_available": AUDIO_SEARCH_AVAILABLE,
#         "timestamp": os.popen('date').read().strip()
#     })

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
# AUDIO ANALYSIS ENDPOINTS
# ============================================================================

# @app.route('/request_embedding', methods=['POST'])
# @handle_errors
# def request_embedding():
#     if not AUDIO_SEARCH_AVAILABLE:
#         return jsonify({"error": "Audio search functionality not available"}), 503
    
#     data = request.get_json()
#     if not data:
#         return jsonify({"error": "Invalid JSON body"}), 400
#     song_id = data.get('song_id')

#     if not song_id:
#         return jsonify({"error": "Missing required parameter 'song_id'"}), 400
    
#     try:
#         print(f"requesting embedding for song ID: {song_id}...")
#         audio_search.request_audio_to_be_processed(song_id)
#         return jsonify({"status": "Embedding creation requested", "song_id": song_id})
#     except Exception as e:
#         logger.error(f"Error creating embedding: {str(e)}")
#         return jsonify({"error": "Failed to create embedding", "message": str(e)}), 500

# @app.route('/is_song_in_process_queue', methods=['GET'])
# @handle_errors
# def is_song_in_process_queue():
#     if not AUDIO_SEARCH_AVAILABLE:
#         return jsonify({"error": "Audio search functionality not available"}), 503
    
#     song_id = request.args.get('song_id')
#     if not song_id:
#         return jsonify({"error": "Missing required parameter 'song_id'"}), 400

#     try:
#         in_queue = audio_search.is_song_in_process_queue(song_id)
#         return jsonify({"song_id": song_id, "in_process_queue": in_queue})
#     except Exception as e:
#         logger.error(f"Error checking process queue: {str(e)}")
#         return jsonify({"error": "Failed to check process queue", "message": str(e)}), 500
    
# @app.route('/search_similar_songs', methods=['GET'])
# @handle_errors
# def search_similar_songs():
#     if not AUDIO_SEARCH_AVAILABLE:
#         return jsonify({"error": "Audio search functionality not available"}), 503
    
#     song_id = request.args.get('song_id')
#     if not song_id:
#         return jsonify({"error": "Missing required parameter 'song_id'"}), 400

#     try:
#         similar_songs = audio_search.recommend_similar_songs_with_song_id(song_id, top_k=50, exclude_ids=[song_id])
#         return jsonify({"song_id": song_id, "similar_songs": similar_songs})
#     except Exception as e:
#         logger.error(f"Error searching similar songs: {str(e)}")
#         return jsonify({"error": "Failed to search similar songs", "message": str(e)}), 500

# # ============================================================================
# # DJ MIXING ENDPOINTS
# # ============================================================================

# @app.route('/dj_calculate_mix', methods=['POST'])
# def calculate_mix():
#     """
#     Calculate optimal mix between two songs.
    
#     Request JSON:
#     {
#         "current_song_id": "video_id_1",
#         "next_song_id": "video_id_2",
#         "quality": "high",  // optional
#         "current_position": 120.5  // optional, current playback position in seconds
#     }
    
#     Response JSON:
#     {
#         "success": true,
#         "mix_instruction": {
#             "mix_out_point": { "time_seconds": 175.47, ... },
#             "mix_in_point": { "time_seconds": 15.67, ... },
#             "bpm_sync": { "sync_type": "pitch_up", ... },
#             ...
#         }
#     }
#     """
#     if not AUDIO_SEARCH_AVAILABLE:
#         return jsonify({"error": "Audio analysis functionality not available"}), 503
    
#     try:
#         data = request.get_json()
#         current_song_id = data.get('current_song_id')
#         next_song_id = data.get('next_song_id')
#         quality = data.get('quality', 'high')
#         current_position = data.get('current_position')
        
#         if not current_song_id or not next_song_id:
#             return jsonify({'success': False, 'error': 'Both song_ids are required'}), 400
        
#         # Analyze both songs (use cache if available)
#         print(f"Calculating mix: {current_song_id} -> {next_song_id}")

#         audio_1, sr_1 = decoder.decode_chunks_to_numpy(current_song_id, quality)
#         features_1 = analyzer.extract_dj_features(audio_1, sr_1)

#         audio_2, sr_2 = decoder.decode_chunks_to_numpy(next_song_id, quality)
#         features_2 = analyzer.extract_dj_features(audio_2, sr_2)
        
#         # Calculate mix instruction
#         mix_instruction = mix_calculator.calculate_optimal_mix(
#             features_1, 
#             features_2,
#             current_position
#         )
        
#         # Convert MixInstruction to dict for JSON serialization
#         mix_data = {
#             'mix_out_point': {
#                 'time_seconds': mix_instruction.mix_out_point.time_seconds,
#                 'bar_position': mix_instruction.mix_out_point.bar_position,
#                 'phrase_position': mix_instruction.mix_out_point.phrase_position,
#                 'energy_level': mix_instruction.mix_out_point.energy_level,
#                 'confidence': mix_instruction.mix_out_point.confidence,
#                 'beat_strength': mix_instruction.mix_out_point.beat_strength,
#             },
#             'mix_in_point': {
#                 'time_seconds': mix_instruction.mix_in_point.time_seconds,
#                 'bar_position': mix_instruction.mix_in_point.bar_position,
#                 'phrase_position': mix_instruction.mix_in_point.phrase_position,
#                 'energy_level': mix_instruction.mix_in_point.energy_level,
#                 'confidence': mix_instruction.mix_in_point.confidence,
#                 'beat_strength': mix_instruction.mix_in_point.beat_strength,
#             },
#             'bpm_sync': {
#                 'sync_type': mix_instruction.bpm_sync.sync_type.value,
#                 'pitch_adjustment': mix_instruction.bpm_sync.pitch_adjustment,
#                 'target_bpm': mix_instruction.bpm_sync.target_bpm,
#                 'current_bpm': mix_instruction.bpm_sync.current_bpm,
#             },
#             'mix_type': mix_instruction.mix_type.value,
#             'key_shift_semitones': mix_instruction.key_shift_semitones,
#             'crossfade_curve': mix_instruction.crossfade_curve,
#             'mix_out_duration': mix_instruction.mix_out_duration,
#             'mix_in_duration': mix_instruction.mix_in_duration,
#             'overlap_duration': mix_instruction.overlap_duration,
#             'beat_sync_offset': mix_instruction.beat_sync_offset,
#             'phrase_alignment': mix_instruction.phrase_alignment,
#             'compatibility_score': mix_instruction.compatibility_score,
#             'energy_flow_score': mix_instruction.energy_flow_score,
#             'harmonic_compatibility': mix_instruction.harmonic_compatibility,
#             'timing_precision': mix_instruction.timing_precision,
#         }
        
#         return jsonify({
#             'success': True,
#             'current_song_id': current_song_id,
#             'next_song_id': next_song_id,
#             'mix_instruction': mix_data
#         })
        
#     except Exception as e:
#         print(f"Error calculating mix: {e}")
#         traceback.print_exc()
#         return jsonify({'success': False, 'error': str(e)}), 500


# @app.route('/get_stitched_mix', methods=['POST'])
# @handle_errors
# def get_stitched_mix():
#     """
#     Create a stitched HLS stream that seamlessly mixes two songs.
#     Returns a single HLS playlist URL that can be played directly on Safari/iOS.
    
#     Request JSON:
#     {
#         "song_id_1": "video_id_1",
#         "song_id_2": "video_id_2",
#         "quality": "high",  // optional: 'low', 'medium', 'high', 'ultra-high'
#         "mix_style": "balanced"  // optional: 'quick', 'balanced', 'extended', 'long'
#     }
    
#     Response JSON:
#     {
#         "success": true,
#         "mix_id": "abc123...",
#         "playlist_url": "/hls/mixes/abc123.../audio/master.m3u8",
#         "mix_info": { ... },
#         "cached": false
#     }
#     """
#     if not AUDIO_SEARCH_AVAILABLE:
#         return jsonify({"error": "Audio analysis functionality not available"}), 503
    
#     try:
#         data = request.get_json()
#         song_id_1 = data.get('song_id_1')
#         song_id_2 = data.get('song_id_2')
#         quality = data.get('quality', 'high')
#         mix_style = data.get('mix_style', 'balanced')
        
#         if not song_id_1 or not song_id_2:
#             return jsonify({'success': False, 'error': 'Both song_id_1 and song_id_2 are required'}), 400
        
#         print(f"Creating stitched mix: {song_id_1} -> {song_id_2} (quality: {quality}, style: {mix_style})")
        
#         # First, calculate the optimal mix instruction
#         audio_1, sr_1 = decoder.decode_chunks_to_numpy(song_id_1, quality)
#         features_1 = analyzer.extract_dj_features(audio_1, sr_1)
        
#         audio_2, sr_2 = decoder.decode_chunks_to_numpy(song_id_2, quality)
#         features_2 = analyzer.extract_dj_features(audio_2, sr_2)
        
#         mix_instruction = mix_calculator.calculate_optimal_mix(features_1, features_2)
        
#         # Create the stitched HLS stream
#         mix_result = mixer.create_mixed_audio_wav(
#             song_id_1,
#             song_id_2,
#             mix_instruction,
#             mix_style=mix_style
#         )
        
#         return jsonify({
#             'success': True,
#             **mix_result
#         })
        
#     except Exception as e:
#         print(f"Error creating stitched mix: {e}")
#         traceback.print_exc()
#         return jsonify({'success': False, 'error': str(e)}), 500
    
@app.route('/get_song_analysis', methods=['GET'])
@handle_errors
def get_song_analysis():
    try:
        song_id = request.args.get("video_id")

        if not song_id:
            return jsonify({'success': False, 'error': 'song_id is required'}), 400

        # Perform the analysis
        analysis_result = analyze_audio_for_song(song_id)

        if not analysis_result:
            return jsonify({'success': False, 'error': 'Failed to analyze song'}), 500

        return jsonify({
            'success': True,
            'analysis': analysis_result
        })

    except Exception as e:
        print(f"Error getting song analysis: {e}")
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Application entry point
if __name__ == '__main__':
    try:
        port = int(os.getenv('FLASK_PORT', 5002))
        worker_name = os.getenv('WORKER_NAME', 'Analysis Worker')
        worker_cores = os.getenv('WORKER_CORES', '2')
        
        logger.info(f"Starting Flask server: {worker_name}")
        logger.info(f"Port: {port}, Cores: {worker_cores}")
        
        app.run(debug=False, host='0.0.0.0', port=port, threaded=True)
    except Exception as e:
        logger.error(f"Failed to start server: {str(e)}")
        sys.exit(1)

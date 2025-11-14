# """
# DJ Integration API - Flask endpoint for Node.js to request DJ mixes
# Provides REST API for analyzing songs and creating mixes
# """

# from flask import Flask, request, jsonify
# from flask_cors import CORS
# import traceback
# import sys
# import os

# # Add parent directory to path
# sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# from hls_audio_decoder import HLS_Audio_Decoder
# from analysis_2 import DJ_Audio_Analyzer, DJ_Mix_Calculator, MixInstruction
# from dj_mixer import DJ_Audio_Mixer

# app = Flask(__name__)
# CORS(app)  # Enable CORS for Node.js requests

# # Initialize components
# decoder = HLS_Audio_Decoder()
# analyzer = DJ_Audio_Analyzer()
# mix_calculator = DJ_Mix_Calculator()
# mixer = DJ_Audio_Mixer()

# # Cache for analyzed features to avoid re-analysis
# features_cache = {}


# @app.route('/health', methods=['GET'])
# def health_check():
#     """Health check endpoint."""
#     return jsonify({'status': 'ok', 'service': 'dj-integration'})


# @app.route('/api/dj/analyze', methods=['POST'])
# def analyze_song():
#     """
#     Analyze a song for DJ features.
    
#     Request JSON:
#     {
#         "song_id": "video_id_here",
#         "quality": "high"  // optional, default: "high"
#     }
    
#     Response JSON:
#     {
#         "success": true,
#         "song_id": "...",
#         "features": { ... },
#         "cached": false
#     }
#     """
#     try:
#         data = request.get_json()
#         song_id = data.get('song_id')
#         quality = data.get('quality', 'high')
        
#         if not song_id:
#             return jsonify({'success': False, 'error': 'song_id is required'}), 400
        
#         # Check cache first
#         cache_key = f"{song_id}:{quality}"
#         if cache_key in features_cache:
#             print(f"Returning cached features for {song_id}")
#             return jsonify({
#                 'success': True,
#                 'song_id': song_id,
#                 'features': features_cache[cache_key],
#                 'cached': True
#             })
        
#         # Decode and analyze
#         print(f"Analyzing song: {song_id} (quality: {quality})")
#         audio_array, sample_rate = decoder.decode_chunks_to_numpy(song_id, quality)
#         features = analyzer.extract_dj_features(audio_array, sample_rate)
        
#         if features is None:
#             return jsonify({'success': False, 'error': 'Failed to extract features'}), 500
        
#         # Cache the results
#         features_cache[cache_key] = features
        
#         return jsonify({
#             'success': True,
#             'song_id': song_id,
#             'features': features,
#             'cached': False
#         })
        
#     except Exception as e:
#         print(f"Error analyzing song: {e}")
#         traceback.print_exc()
#         return jsonify({'success': False, 'error': str(e)}), 500


# @app.route('/api/dj/calculate-mix', methods=['POST'])
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
#     try:
#         data = request.get_json()
#         current_song_id = data.get('current_song_id')
#         next_song_id = data.get('next_song_id')
#         quality = data.get('quality', 'high')
#         current_position = data.get('current_position')
        
#         if not current_song_id or not next_song_id:
#             return jsonify({'success': False, 'error': 'Both song_ids are required'}), 400
        
#         # Analyze both songs (use cache if available)
#         print(f"Calculating mix: {current_song_id} → {next_song_id}")
        
#         cache_key_1 = f"{current_song_id}:{quality}"
#         cache_key_2 = f"{next_song_id}:{quality}"
        
#         # Get or analyze first song
#         if cache_key_1 not in features_cache:
#             audio_1, sr_1 = decoder.decode_chunks_to_numpy(current_song_id, quality)
#             features_cache[cache_key_1] = analyzer.extract_dj_features(audio_1, sr_1)
        
#         # Get or analyze second song
#         if cache_key_2 not in features_cache:
#             audio_2, sr_2 = decoder.decode_chunks_to_numpy(next_song_id, quality)
#             features_cache[cache_key_2] = analyzer.extract_dj_features(audio_2, sr_2)
        
#         features_1 = features_cache[cache_key_1]
#         features_2 = features_cache[cache_key_2]
        
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


# @app.route('/api/dj/create-mix', methods=['POST'])
# def create_mix():
#     """
#     Create a mixed audio file and HLS segments.
    
#     Request JSON:
#     {
#         "current_song_id": "video_id_1",
#         "next_song_id": "video_id_2",
#         "quality": "high",  // optional
#         "current_position": 120.5,  // optional
#         "auto_calculate": true  // optional, if true will calculate mix instruction automatically
#     }
    
#     Or with explicit mix instruction:
#     {
#         "current_song_id": "video_id_1",
#         "next_song_id": "video_id_2",
#         "mix_instruction": { ... }  // Full mix instruction object
#     }
    
#     Response JSON:
#     {
#         "success": true,
#         "mix_id": "abc123def456",
#         "playlist_url": "/hls/mixes/abc123def456/master.m3u8",
#         "mix_info": {
#             "duration": 345.67,
#             "mix_out_time": 175.47,
#             "mix_in_time": 15.67,
#             ...
#         }
#     }
#     """
#     try:
#         data = request.get_json()
#         current_song_id = data.get('current_song_id')
#         next_song_id = data.get('next_song_id')
#         quality = data.get('quality', 'high')
        
#         if not current_song_id or not next_song_id:
#             return jsonify({'success': False, 'error': 'Both song_ids are required'}), 400
        
#         # Get or calculate mix instruction
#         if 'mix_instruction' in data and not data.get('auto_calculate', False):
#             # Use provided mix instruction (reconstruct MixInstruction object)
#             mix_inst_data = data['mix_instruction']
#             # This requires reconstructing the dataclass - simplified for now
#             # In production, you'd fully reconstruct all nested objects
#             print("Using provided mix instruction")
#             # For now, we'll recalculate to ensure we have the full MixInstruction object
            
#         # Calculate mix instruction
#         print(f"Creating mix: {current_song_id} → {next_song_id}")
        
#         cache_key_1 = f"{current_song_id}:{quality}"
#         cache_key_2 = f"{next_song_id}:{quality}"
        
#         # Analyze songs if not cached
#         if cache_key_1 not in features_cache:
#             audio_1, sr_1 = decoder.decode_chunks_to_numpy(current_song_id, quality)
#             features_cache[cache_key_1] = analyzer.extract_dj_features(audio_1, sr_1)
        
#         if cache_key_2 not in features_cache:
#             audio_2, sr_2 = decoder.decode_chunks_to_numpy(next_song_id, quality)
#             features_cache[cache_key_2] = analyzer.extract_dj_features(audio_2, sr_2)
        
#         # Calculate mix instruction
#         mix_instruction = mix_calculator.calculate_optimal_mix(
#             features_cache[cache_key_1],
#             features_cache[cache_key_2],
#             data.get('current_position')
#         )
        
#         # Create the actual mixed audio file
#         mix_id, mix_info = mixer.create_mixed_audio(
#             current_song_id,
#             next_song_id,
#             mix_instruction,
#             quality
#         )
        
#         playlist_url = mixer.get_mix_playlist_url(mix_id)
        
#         return jsonify({
#             'success': True,
#             'mix_id': mix_id,
#             'playlist_url': playlist_url,
#             'mix_info': mix_info
#         })
        
#     except Exception as e:
#         print(f"Error creating mix: {e}")
#         traceback.print_exc()
#         return jsonify({'success': False, 'error': str(e)}), 500


# @app.route('/api/dj/list-available-songs', methods=['GET'])
# def list_available_songs():
#     """List all available songs in HLS storage."""
#     try:
#         songs = decoder.get_available_songs()
#         return jsonify({
#             'success': True,
#             'songs': songs,
#             'count': len(songs)
#         })
#     except Exception as e:
#         print(f"Error listing songs: {e}")
#         return jsonify({'success': False, 'error': str(e)}), 500


# @app.route('/api/dj/clear-cache', methods=['POST'])
# def clear_cache():
#     """Clear the features cache."""
#     global features_cache
#     cache_size = len(features_cache)
#     features_cache = {}
#     return jsonify({
#         'success': True,
#         'message': f'Cleared {cache_size} cached features'
#     })


# if __name__ == '__main__':
#     print("🎧 Starting DJ Integration API...")
#     print("=" * 60)
#     print("Available endpoints:")
#     print("  GET  /health - Health check")
#     print("  POST /api/dj/analyze - Analyze a song")
#     print("  POST /api/dj/calculate-mix - Calculate mix between two songs")
#     print("  POST /api/dj/create-mix - Create mixed audio file")
#     print("  GET  /api/dj/list-available-songs - List available songs")
#     print("  POST /api/dj/clear-cache - Clear features cache")
#     print("=" * 60)
    
#     # Run on port 5001 to avoid conflicts
#     app.run(host='0.0.0.0', port=5001, debug=True)

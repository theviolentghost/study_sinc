try:
    # Prefer package-relative import when used as a package
    from .analysis import Audio_Analyzer
except Exception:
    # Fallbacks for different execution contexts
    try:
        from music.recommendation.analysis import Audio_Analyzer
    except Exception:
        Audio_Analyzer = None

__all__ = ["Audio_Analyzer"]

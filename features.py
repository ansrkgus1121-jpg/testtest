"""Audio energy uses both stereo channels, without cancellation or per-stem gain."""
import numpy as np

FPS = 50


def extract_features(audio: np.ndarray, sr: int) -> dict:
    audio = np.asarray(audio, dtype=np.float32)
    if audio.ndim != 2 or not audio.shape[1] or sr < FPS or not np.isfinite(audio).all():
        raise ValueError('유효한 오디오 데이터가 아닙니다.')
    hop = round(sr / FPS)
    rms = []
    for start in range(0, audio.shape[1], hop):
        chunk = audio[:, start:start + hop]
        rms.append(float(np.sqrt(np.mean(chunk * chunk))))
    # A fixed -60dB floor and fixed 0.4 RMS ceiling preserve relative stem levels.
    energy = np.sqrt(np.clip((np.array(rms) - .001) / .399, 0, 1))
    onset = np.clip(np.maximum(0, np.diff(energy, prepend=energy[0])) * 3, 0, 1)
    return {'energy': energy.round(6).tolist(), 'onset': onset.round(6).tolist()}

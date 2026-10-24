"""Isolated Demucs worker. Its atomic status files are read by the web process."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

import soundfile as sf

DEMUCS_COMMIT = '2883f3db65617d6d178c6ed10d869dc14e44e59b'
MODEL = 'htdemucs'
CONFIG_KEY = f'{DEMUCS_COMMIT}:{MODEL}:cpu:shifts0:segment7:features-v1'


def write_json(path: Path, value: dict):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False))
    tmp.replace(path)


def decode_audio(source: Path, destination: Path):
    ffmpeg = shutil.which('ffmpeg') or '/opt/homebrew/bin/ffmpeg'
    if not Path(ffmpeg).exists():
        raise ValueError('FFmpeg를 찾을 수 없습니다. 사용법의 설치 절차를 확인하세요.')
    result = subprocess.run([ffmpeg, '-nostdin', '-v', 'error', '-y', '-i', str(source),
                             '-t', '301', '-vn', '-ac', '2', '-ar', '44100',
                             '-c:a', 'pcm_f32le', str(destination)], capture_output=True, timeout=90)
    if result.returncode:
        raise ValueError('파일을 읽을 수 없습니다. 정상적인 MP3 또는 WAV 파일을 선택하세요.')
    info = sf.info(destination)
    if info.duration > 300:
        raise ValueError('최대 5분까지 분석할 수 있습니다.')
    if info.frames < 2:
        raise ValueError('파일에 분석할 소리가 없습니다.')
    return info


def run(job_dir: Path):
    state = json.loads((job_dir / 'job.json').read_text())
    start = time.monotonic()

    def stage(status, message, **extra):
        state.update(status=status, message=message, **extra)
        write_json(job_dir / 'job.json', state)

    decoded = job_dir / 'audio.wav'
    try:
        stage('decoding', '음악 파일 확인 중')
        info = decode_audio(job_dir / state['source'], decoded)
        stage('loading', '분리 모델 준비 중 · 최초 실행은 모델 다운로드가 필요합니다', duration=info.duration)
        import torch
        from demucs.api import Separator
        from features import extract_features, FPS
        torch.set_num_threads(min(4, os.cpu_count() or 1))
        torch.manual_seed(0)
        separator = Separator(model=MODEL, device='cpu', shifts=0, segment=7,
                              split=True, overlap=.25, progress=True, jobs=0)
        signal, sr = sf.read(decoded, dtype='float32', always_2d=True)
        stage('separating', '보컬·드럼·베이스·기타 반주 분리 중')
        with torch.inference_mode():
            _, stems = separator.separate_tensor(torch.from_numpy(signal.T.copy()), sr)
        stage('features', '리본 반응 데이터 준비 중')
        data = {'fps': FPS, 'duration': info.duration, 'model': MODEL,
                'demucs_commit': DEMUCS_COMMIT, 'stems': {}}
        for name, tensor in stems.items():
            samples = tensor.cpu().numpy()
            data['stems'][name] = extract_features(samples, sr)
        write_json(job_dir / 'features.json', data)
        stage('ready', '분석 완료', elapsed_seconds=round(time.monotonic() - start, 2))
    except Exception as exc:
        import traceback
        traceback.print_exc()
        message = str(exc) if isinstance(exc, ValueError) else '분석에 실패했습니다. 모델 다운로드 연결과 저장 공간을 확인한 뒤 다시 시도하세요.'
        stage('failed', message)
    finally:
        decoded.unlink(missing_ok=True)
        shutil.rmtree(job_dir / 'stems', ignore_errors=True)
        if state['status'] == 'failed':
            (job_dir / state['source']).unlink(missing_ok=True)


if __name__ == '__main__':
    run(Path(sys.argv[1]).resolve())

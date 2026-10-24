import io
import json
import time
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from features import extract_features
from server import create_app
from worker import decode_audio


def test_silence_and_antiphase_stereo():
    silent = extract_features(np.zeros((2, 1001)), 1000)
    assert len(silent['energy']) == 51
    assert max(silent['energy']) == 0
    t = np.arange(1000) / 1000
    wave = np.sin(t * 2 * np.pi * 50) * .25
    anti = extract_features(np.stack([wave, -wave]), 1000)
    assert min(anti['energy']) > .4
    assert np.isfinite(anti['onset']).all()


def test_features_retain_dynamics_and_quiet_stems():
    a = np.r_[np.zeros(100), np.ones(100)*.1, np.ones(100)*.5]
    f = extract_features(a[None], 1000)
    assert f['energy'][0] == 0
    assert 0 < f['energy'][7] < f['energy'][12] <= 1
    assert max(extract_features(np.ones((2, 100)) * .00001, 1000)['energy']) == 0
    assert max(f['onset']) > 0


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path), base_url='http://127.0.0.1:8765') as c:
        yield c


def test_local_origin_and_paths(client):
    assert client.get('/api/health').status_code == 200
    assert client.get('/api/health', headers={'Host':'evil.example'}).status_code == 403
    assert client.post('/api/jobs', headers={'Origin':'https://evil.example'}).status_code == 403
    assert client.post('/api/jobs', headers={'Origin':'http://localhost:8765'}).status_code == 403
    assert client.get('/api/jobs/not-an-id').status_code == 404
    assert client.get('/api/jobs/' + 'a'*64).status_code == 404


def test_upload_validation(client, monkeypatch):
    assert client.post('/api/jobs', files={'file':('x.txt',b'bad')}).status_code == 400
    assert client.post('/api/jobs', files={'file':('x.mp3',b'')}).status_code == 400
    monkeypatch.setattr('server.MAX_BYTES', 32)
    assert client.post('/api/jobs', files={'file':('x.mp3',b'x'*33)}).status_code == 413
    assert not list(client.app.state.manager.root.glob('upload-*'))


def test_failed_job_can_retry_and_be_deleted(client):
    def upload():
        r=client.post('/api/jobs',files={'file':('broken.mp3',b'not audio')})
        assert r.status_code==202
        return r.json()['id']
    jid=upload()
    # An active process owns the single slot, including deletion.
    r=client.delete('/api/jobs/'+jid)
    assert r.status_code==409
    assert client.post('/api/jobs',files={'file':('other.mp3',b'other')}).status_code==409
    for _ in range(150):
        state=client.get('/api/jobs/'+jid).json()
        if state['status']=='failed':break
        time.sleep(.1)
    assert state['status']=='failed'
    assert state['message']
    assert client.get('/api/jobs/'+jid+'/features').status_code==409
    assert client.delete('/api/jobs/'+jid).status_code==200
    assert client.get('/api/jobs/'+jid).status_code==404
    assert upload()==jid


def test_decoder_rejects_overlong_and_corrupt_files(tmp_path):
    bad=tmp_path/'bad.mp3';bad.write_bytes(b'not audio')
    with pytest.raises(ValueError):decode_audio(bad,tmp_path/'bad.wav')
    long=tmp_path/'long.wav';sf.write(long,np.zeros(301*8000,dtype=np.float32),8000)
    with pytest.raises(ValueError,match='5분'):decode_audio(long,tmp_path/'decoded.wav')


def test_cache_requires_complete_outputs(client):
    # Cached jobs remain readable; missing artifacts must never be called ready.
    root=client.app.state.manager.root
    jid='b'*64; d=root/jid;d.mkdir()
    (d/'job.json').write_text(json.dumps({'id':jid,'status':'ready','message':'완료'}))
    assert client.get('/api/jobs/'+jid).json()['status']=='failed'


def test_completed_worker_cannot_be_overwritten_by_poll_race(client):
    manager=client.app.state.manager
    jid='c'*64;path=manager.root/jid;path.mkdir();(path/'stems').mkdir()
    state={'id':jid,'status':'separating','message':'분리 중'}
    (path/'job.json').write_text(json.dumps(state))
    for name in ['audio.wav','features.json','stems/drums.wav','stems/bass.wav','stems/other.wav','stems/vocals.wav']:
        (path/name).touch()
    # Substitute only the process scheduling boundary: the worker publishes and
    # exits between status's read and poll. The state-file reads/writes are real.
    class CompletedProcess:
        def poll(self):
            (path/'job.json').write_text(json.dumps({**state,'status':'ready','message':'완료'}))
            return 0
    manager.active_id=jid;manager.process=CompletedProcess()
    assert manager.status(jid)['status']=='ready'
    assert json.loads((path/'job.json').read_text())['status']=='ready'

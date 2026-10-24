"""Start the local service and open its browser when ready."""
import json
import os
import socket
import threading
import time
import urllib.error
import urllib.request
import webbrowser

port = int(os.environ.get('RIBBON_PORT', '8765'))
if not 1024 <= port <= 65535:
    raise SystemExit('RIBBON_PORT는 1024–65535 사이여야 합니다.')
url = f'http://127.0.0.1:{port}'


def healthy():
    try:
        with urllib.request.urlopen(url + '/api/health', timeout=1) as response:
            return json.load(response).get('app') == 'ribbon-music'
    except (OSError, ValueError, urllib.error.URLError):
        return False


def open_page():
    if os.environ.get('RIBBON_NO_OPEN') != '1':
        webbrowser.open(url)


if healthy():
    print('이미 실행 중입니다:', url)
    open_page()
else:
    with socket.socket() as probe:
        try: probe.bind(('127.0.0.1', port))
        except OSError:
            raise SystemExit(f'{port} 포트를 다른 프로그램이 사용 중입니다. RIBBON_PORT=8766 ./start.command 로 실행하세요.')

    def wait_and_open():
        for _ in range(60):
            if healthy():
                open_page();return
            time.sleep(.25)

    threading.Thread(target=wait_and_open, daemon=True).start()
    import uvicorn
    print('음악 리본:', url, '\n종료: 이 창에서 Control+C')
    uvicorn.run('server:app', host='127.0.0.1', port=port, workers=1)

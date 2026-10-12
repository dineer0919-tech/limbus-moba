# 림버스 MOBA 전용 서버

방 기록(로비 · 픽 · 쏠전)과 게임 계산을 모두 이 서버가 맡습니다. 외부 패키지 없이 Node.js(20 이상)만 있으면 됩니다.

## 설치 · 업데이트 (Oracle Cloud Ubuntu)

```
curl -fsSL https://raw.githubusercontent.com/dineer0919-tech/limbus-moba/main/server/setup.sh | sudo bash
```

끝나면 `1-2-3-4.sslip.io` 같은 서버 주소가 나옵니다.

## 자주 쓰는 명령

| 하고 싶은 것 | 명령 |
|---|---|
| 상태 보기 | `curl https://주소/health` |
| 기록 보기 | `sudo journalctl -u limbus-moba -f` |
| 다시 켜기 | `sudo systemctl restart limbus-moba` |
| 서버 코드 업데이트 | 위 설치 명령을 한 번 더 |

게임(index.html)을 GitHub에 새로 올리면 서버가 몇 분 안에 알아서 새 버전을 받아 옵니다. 새 버전으로 접속한 사람이 있으면 바로 받아 옵니다.

## 파일

- `server.js`: 서버 본체 (방 기록 · 접속 · 방마다 게임 계산 스레드 관리)
- `engine.js`: 방 하나의 게임 계산 (게임 코드를 화면 없이 실행)
- `db.js`: 메모리 안의 실시간 데이터베이스
- `ws.js`: WebSocket
- `stub.js`: 화면 없는 실행용 가짜 브라우저
- `setup.sh`: 설치 스크립트

## 환경 변수

- `PORT` (기본 8080)
- `GAME_URL`: 게임을 받아 올 주소 (기본: GitHub Pages)
- `TICK`: 초당 계산 횟수 (기본 60)
